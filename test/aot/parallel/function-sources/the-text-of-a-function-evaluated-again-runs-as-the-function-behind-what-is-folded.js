const made = [];
function make() { return { calls: 0, list: [], m() { return this === undefined ? "no this" : typeof this.calls; }, g(x) { return x + 1; }, a: 1, b: 2, on: true, x: 5 }; }
const functions = [
  function (o) { return 1 && o.a; },
  function (o) { return "" || o.b; },
  function (o) { return (o.calls++, true) ? "yes" : "no"; },
  function (o) { return (o.calls++, false) ? "yes" : "no"; },
  function (o) { return (o.calls++, 1) && o.a; },
  function (o) { return (o.calls++, 0) || o.b; },
  function (o) { return (o.calls++, null) ?? o.b; },
  function (o) { return (1 && o.m)(); },
  function (o) { return ("x" && o.m)(); },
  function (o) { return (0 || o.m)(); },
  function (o) { return (void 0 ?? o.m)(); },
  function (o) { return (1 ? o.m : 0)(); },
  function (o) { return typeof (1 && missing); },
  function (o) { return delete (1 && o.x), o.x; },
  function (o) {
    let h = o
    1 && [1].map(o.g)
    return h === o
  },
  function (o) {
    let h = o.g
    "x" && (o.calls++, o.calls)
    return typeof h
  },
  function (o) {
    let h = o.a
    0 || -o.b
    return h
  },
  function (o) {
    let h = o.a
    1 && `t`.length
    return h
  },
  function (o) {
    let h = o.a
    1 && /x/.test("x")
    return h
  },
  function (o) { 1 && "use strict"; return this === undefined; },
  function (o) { "" || "use strict"; return this === undefined; },
  function (o) { 0 ? 0 : "use strict"; return this === undefined; },
  function (o) { for (let i = 1 ? "a" in o : 0; i; i = false) return "in"; return "out"; },
  function (o) { for (let i = 1 && ("a" in o); i; i = false) return "in"; return "out"; },
  function (o) { return (() => 1 && { kept: o.a })().kept; },
  function (o) { return (() => 1 ? { kept: o.a } : 0)().kept; },
  function (o) { 1 && { kept: o.a }.kept; return o.a; },
  function (o) { 1 && function () {}.name; return o.a; },
  function (o) { 1 && class {}.name; return o.a; },
  function (o) { return 1 && 2 && o.a; },
  function (o) { return 0 || "" || o.b; },
  function (o) { return 1 && (0 || o.b); },
  function (o) { return (1 && o.a) + (0 || o.b); },
  function (o) { return -(1 && o.a); },
  function (o) { return (1 && o.a) ** 2; },
  function (o) { return (1 && -o.a) ** 2; },
  function (o) { return !(1 && o.on); },
  function (o) { return new (1 && Object)().constructor === Object; },
  function (o) { return (1 && o).a; },
  function (o) { return (1 && o.g)?.(1); },
  function (o) { return [...(1 && [o.a, o.b])].length; },
  function (o) { return `${1 && o.a}`; },
  function (o) { return 1 && o.a, o.b; },
  function (o) { return (1 && (o.calls++, o.a)); },
  function (o) { const inner = 1 && function () {}; return inner.name.length >= 0; },
  async function (o) { return 1 && await o.a; },
  function* (o) { yield 1 && o.a; },
  function (o) { return o.on && 1 && o.a; },
  function (o) { return o.on ? 1 && o.a : 0; },
  function (o) { if (1 && o.on) return "then"; return "else"; },
  function (o) { while (1 && o.calls++ < 2); return o.calls; },
  function (o) { switch (1 && o.a) { case 1 && 1: return "one"; } return "other"; },
  function (o) { return { key: 1 && o.a, [1 && "k"]: 0 || o.b }.k; },
  function (o) { throw 1 && new RangeError("thrown"); },
];
function show(run) { try { const value = run(); return typeof value === "object" && value !== null && typeof value.next === "function" ? JSON.stringify([...value]) : String(value); } catch (error) { return "threw " + error.constructor.name; } }
const lines = [];
functions.forEach((asked, index) => {
  let again;
  try { again = new Function("return (" + String(asked) + "\n)")(); } catch (error) { lines.push(index + ": THE TEXT DOES NOT PARSE: " + error.constructor.name); return; }
  const first = make(), second = make();
  const one = show(() => asked(first)), two = show(() => again(second));
  lines.push(index + ": " + (one === two && first.calls === second.calls ? "alike" : "THE TEXT RUNS OTHERWISE") + " " + one + " " + two + " " + first.calls + " " + second.calls);
});
console.log(lines.join("\n"));
