// What a sloppy eval inside of an evaluated text declares stands in front of the global constants; nothing replaces the names of such a text.
const say = (...all) => console.log(all.map(String).join(" | "));
const held = (0, eval)('(function (l) { eval("var undefined = 3"); return [undefined, typeof undefined, l === undefined, l == undefined, undefined ? "truthy" : "falsy"].join(" "); })');
const arrow = globalThis.eval('(() => { eval("var Infinity = 4"); return [Infinity === 4 ? 4 : "wrong", typeof Infinity, -Infinity, 1 / 0].join(" "); })');
const sometimes = (0, eval)('(function (l) { if (l) eval("var undefined = 5, NaN = 6, Infinity = 7"); return [undefined, NaN, Infinity].join(" "); })');
const inner = (0, eval)('(function (l) { eval("var undefined = 8"); const f = () => undefined; return [f(), (function () { return undefined; })(), [undefined].length, { a: undefined }.a].join(" "); })');
const stored = (0, eval)('(function (l) { eval("var undefined = 9"); undefined = l; return undefined; })');
const tested = (0, eval)('(function (l) { eval("var undefined = 1"); if (l === undefined) return "one"; if (l !== undefined) return "no one " + typeof l; })');
const spared = (0, eval)('(function (l) { eval("var other = 2"); return [l === undefined, undefined, Infinity, NaN, other].join(" "); })');
const strict = (0, eval)('(function (l) { "use strict"; eval("var undefined = 2"); return [l === undefined, undefined].join(" "); })');
const parameter = (0, eval)('(function (undefined) { return [undefined, typeof undefined].join(" "); })');
for (let turn = 0; turn < 3; turn++) {
  say(held(3), held(), arrow(), sometimes(0), sometimes(1), inner());
  say(stored("text"), stored(undefined), tested(1), tested(undefined), tested("1"), spared(), spared(1), strict(), strict(4), parameter(), parameter(5));
}
