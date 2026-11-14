// Evaluated text is interpreted in an executable: calls whose result is used, dropped or returned by strict code, variables that closures write,
// loops, differences and steps of one at the borders of int32, frames with many variables.
const { edenGC, fullGC } = require("bun:jsc");
const lines = [];
globalThis.collectYoung = () => void edenGC();
globalThis.log = (...values) => void lines.push(values.map(value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? `${value}n` : typeof value === "symbol" ? value.toString() : typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value))).join(" "));
globalThis.collect = () => void fullGC();
globalThis.compiled = function (a, b) {
  return `${a} ${b} ${arguments.length}`;
};
const evaluate = text => {
  try {
    log((0, eval)(text));
  } catch (error) {
    log(error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
};

for (const callee of ["plain", "compiled", "Math.max", "bound", "proxy", "object.method", "object?.method", "object?.none", "null", "5", "Class", "arrow", "rest"])
  evaluate(`(function () {
    const plain = function (a, b) { return [a, b, arguments.length, this === undefined || this === globalThis]; }, object = { method(a) { return [this === object, a]; } };
    const bound = plain.bind(1, "bound"), proxy = new Proxy(plain, { apply: (target, self, list) => "proxy " + list.length }), arrow = (a, b = 3) => [a, b], rest = (a, ...list) => [a, list];
    class Class {}
    let last = [];
    const tries = [
      () => { ${callee}(1, 2); return "dropped"; },
      () => ${callee}(1, 2),
      function () { "use strict"; return ${callee}(1, 2); },
      function () { "use strict"; return ${callee}(1, 2, 3, 4, 5, 6, 7, 8, 9); },
      function () { "use strict"; return ${callee}(); },
    ];
    for (const one of tries) for (let turn = 0; turn < 4; turn++) try { last.push(String(one())); } catch (error) { last.push(error.name + ": " + error.message); }
    return last;
  })()`);

evaluate(`(function () { "use strict"; const down = (n, sum) => (n ? down(n - 1, sum + n) : sum); return down(100000, 0); })()`);
evaluate(`(function () { "use strict"; const even = (n, ...rest) => (n ? odd(n - 1) : "even"), odd = (n, a, b, c, d) => (n ? even(n - 1, 1, 2, 3, 4, 5, 6) : "odd"); return even(50001) + even(50000); })()`);

for (const value of ["2147483647", "-2147483648", "0", "-0", "1.5", "null", "undefined", "'12'", "'x'", "10n", "({ valueOf: () => 4 })", "Symbol.iterator", "NaN"])
  evaluate(`(function () {
    const answers = [], attempt = f => { try { answers.push(Object.is(f(), -0) ? "-0" : String(f())); } catch (error) { answers.push(error.name); } };
    attempt(() => { let x = ${value}; x++; return x; });
    attempt(() => { let x = ${value}; return x++; });
    attempt(() => { let x = ${value}; return ++x; });
    attempt(() => { let x = ${value}; --x; return x; });
    attempt(() => { let x = ${value}; return x - 1; });
    attempt(() => { let x = ${value}; return 1 - x; });
    attempt(() => { let x = ${value}, y = ${value}; return x - y; });
    attempt(() => { let x = ${value}; return x - -2147483648; });
    attempt(() => { let x = ${value}; return x - 2147483647; });
    return answers;
  })()`);

evaluate(`(function () {
  const made = [];
  for (let round = 0; round < 30; round++) {
    let one = round, two, three = "three";
    const write = value => { one = value; two = { value }; three = three + value; return () => { two = one; one = null; return [two, three]; }; };
    made.push(write);
    if (round % 7 === 3) collect();
    write([round]);
    write("text" + round);
    write(round % 2 ? undefined : { round });
    if (round % 5 === 2) collect();
    for (const old of made) old({ from: round });
    made[0] = () => {};
    made.push(() => [one, two, three.length]);
  }
  collect();
  return made.map(read => read("end")).map(answer => (typeof answer === "function" ? answer() : answer)).slice(-6);
})()`);

// What an old variable has been given since the last collection lives on.
evaluate(`(function () {
  const pairs = [];
  for (let i = 0; i < 300; i++) { let kept; pairs.push([() => kept, value => { kept = value; }]); }
  collect();
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < pairs.length; i++) pairs[i][1]({ round, list: [i, "text " + i] });
    collectYoung();
    const others = [];
    for (let i = 0; i < 3000; i++) others.push({ round: "other", list: ["other", i] });
    for (let i = 0; i < pairs.length; i++) { const { round: kept, list } = pairs[i][0](); if (kept !== round || list[0] !== i || list[1] !== "text " + i) return "lost"; }
  }
  return "kept";
})()`);

evaluate(`(function () {
  const answers = [];
  outer: for (let i = 0; ; i++) {
    for (const k in { a: 1, b: 2, c: 3 }) { if (k === "b") continue; if (i === 3) break outer; answers.push(i + k); }
    let n = 3;
    while (n--) { if (n === 1) continue; answers.push(n); }
    do { n++; try { if (n === 2) throw n; if (n === 3) continue; } catch (error) { answers.push("caught " + error); } finally { answers.push("finally"); } } while (n < 4);
    for (const x of [10, 20, 30]) { if (x === 20) continue outer; answers.push(x); }
  }
  return answers.join();
})()`);

for (const count of [0, 1, 2, 3, 4, 5, 8, 9, 15, 16, 33, 70])
  evaluate(`(function () {
    function many(a, b) { ${Array.from({ length: count }, (_, i) => (i % 3 ? `var v${i};` : `let v${i}${i % 2 ? " = a" : ""};`)).join(" ")} const deep = [a, [b, [a, [b, many.name + (a + (b + (a + b)))]]]].flat(9).join(); return [${Array.from({ length: count }, (_, i) => `v${i}`).join()}].map(String).join() + deep; }
    many(1, 2);
    try { (() => { late; let late = 1; })(); } catch (error) { log(error.name); }
    return many("a") + many("b", 4, 5);
  })()`);

console.log(lines.join("\n"));
