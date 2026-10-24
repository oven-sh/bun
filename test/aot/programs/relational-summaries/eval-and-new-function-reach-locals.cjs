// Text that is run at run time. A direct eval reads, writes and keeps the locals and parameters of the function it stands in and of those around it; an indirect eval and `new Function` reach what the global object holds; both replace functions that callers believed they knew.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
globalThis.keptByText = [];
function readsByEval(p, text) {
  return eval(text);
}
function onlyOnARarePath(p, i) {
  if (i % 70 === 69) return eval("kept.push(p), p.n");
  return p.n;
}
function writesAParameter(p, q) {
  eval("p = q");
  return p;
}
function declaresAVariable(p) {
  eval("var hidden = p");
  return hidden;
}
function makesAClosure(p) {
  return eval("(function () { return p.tag; })");
}
function innerFunctionEvals(p) {
  let local = { tag: "local of " + p.tag };
  function inner(text) {
    return eval(text);
  }
  return inner;
}
function evalSeesMoreThanIsDeclared(text) {
  return eval(text);
}
function arrowEvals(p) {
  return (text => eval(text))("kept.length, p");
}
function evalInADefault(p, q = eval("p")) {
  return q;
}
function callsAHelper(o) {
  return helper(o);
}
function helper(o) {
  return o.n;
}
let sum = 0;
let line = "";
const closures = [];
const inners = [];
for (let i = 0; i < 150; i++) {
  const mine = { n: i, tag: "mine" + i };
  const other = { n: -i, tag: "other" + i };
  sum += readsByEval({ n: i, tag: "t" }, "p.n") + onlyOnARarePath({ n: i, tag: "rare" + i }, i) + callsAHelper({ n: 1 });
  line = [readsByEval(mine, "p") === mine, readsByEval(mine, "arguments[0]") === mine, writesAParameter(mine, other) === other, declaresAVariable(mine) === mine, evalSeesMoreThanIsDeclared("arguments[1]", mine) === mine, evalSeesMoreThanIsDeclared("arguments.length", mine, other), arrowEvals(mine) === mine, evalInADefault(mine) === mine].join();
  if (i % 70 === 68) {
    closures.push(makesAClosure({ n: i, tag: "closed over " + i }));
    inners.push(innerFunctionEvals({ n: i, tag: "outer " + i }));
    readsByEval({ n: i, tag: "kept by text " + i }, "kept.push(p)");
    evalSeesMoreThanIsDeclared("kept.push(arguments[2])", 0, { n: i, tag: "an argument without a parameter, kept by text " + i });
    readsByEval({ n: i, tag: "kept on the global object " + i }, "globalThis.keptByText.push(p)");
  }
}
console.log(sum, line, churn(60));
console.log(kept.map(k => k.tag).join(" | "), globalThis.keptByText.map(k => k.tag).join(" | "));
console.log(closures.map(f => f()).join(" | "), inners.map(f => f("local.tag + ' and ' + p.tag")).join(" | "));
for (const inner of inners) inner("local = { tag: 'replaced' }");
console.log(inners.map(f => f("local.tag")).join());

// The helper is replaced by text.
eval("helper = function (o) { kept.push(o); return o.n * 100; }");
let after = 0;
for (let i = 0; i < 3; i++) after += callsAHelper({ n: i + 1, tag: "after the replacement " + i });
console.log(after, churn(40), kept.slice(-3).map(k => k.tag).join(" | "));

// new Function and the indirect eval see the global object only.
globalThis.shelf = [];
globalThis.put = function (o) {
  globalThis.shelf.push(o);
  return globalThis.shelf.length;
};
const putByText = new Function("o", "return put(o);");
const putByIndirectEval = (0, eval)("(function (o) { return put(o); })");
function handsToText(o, which) {
  return which ? putByText(o) : putByIndirectEval(o);
}
let puts = 0;
for (let i = 0; i < 6; i++) puts += handsToText({ tag: "put " + i }, i % 2);
console.log(puts, churn(40), globalThis.shelf.map(o => o.tag).join());
console.log(typeof new Function("return typeof kept")(), new Function("return typeof kept")(), (0, eval)("typeof helper"));

// `with`: names are looked for in the object first, and Symbol.unscopables is read.
const asked = [];
function inside(scope, n) {
  with (scope) {
    return n + extra;
  }
}
var extra = 1000;
let insides = "";
for (let i = 0; i < 50; i++) insides = inside({ extra: i }, 1) + "," + inside({}, 1) + "," + inside({ n: 5 }, 1);
console.log(
  insides,
  inside(
    new Proxy(
      { extra: 2 },
      {
        has(t, key) {
          asked.push("has " + String(key));
          return Reflect.has(t, key);
        },
        get(t, key, receiver) {
          asked.push("get " + String(key));
          return Reflect.get(t, key, receiver);
        },
      },
    ),
    1,
  ),
  asked.join(" "),
);
