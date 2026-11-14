// A function that is called where it is written has a parameter that no argument is passed for. What stands in front of it reads it in its dead zone, its body reads undefined.
const out = [];
const tell = (run) => { try { out.push(String(run())); } catch (error) { out.push(error.constructor.name); } };
tell(() => (function (a = b, b) { return a; })());
tell(() => (function (a = typeof b, b) { return a; })());
tell(() => ((a = typeof b, b) => a)());
tell(() => ((a = b === undefined, b) => a)());
tell(() => (function ({ x = b } = {}, b) { return x; })());
tell(() => (function ([x = typeof b] = [], b) { return x; })([]));
tell(() => (function (a = (() => b)(), b) { return a; })());
tell(() => (function (a, c = !b, b) { return c; })(1));
tell(() => (function (a = b ?? 1, b) { return a; }).call(null));
tell(() => (function (a = `${b}`, b) { return a; })(undefined));
// Their bodies, and what runs behind.
tell(() => (function (a, b) { return [a, b, typeof b, b === undefined, b ? 1 : 2].join(); })(1));
tell(() => (function (a = 2, b) { return [a, b, typeof b].join(); })());
tell(() => (function (a = () => b, b) { return a(); })());
tell(() => (function ({ x } = { x: 3 }, b) { return [x, b].join(); })());
tell(() => (function (a = typeof b, b) { return a; })(undefined, 5));
tell(() => (function (a = 1, b = typeof a, c) { return [a, b, c].join(); })());
tell(() => (function (window, undefined) { return window + String(undefined); })("w"));
console.log(out.join("\n"));
