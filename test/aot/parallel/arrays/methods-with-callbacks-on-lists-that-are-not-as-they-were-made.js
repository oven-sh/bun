// One traversal stands in the place of a method of lists with a callback only where the list is as it was made. Every other receiver gets the method as the engine has it.
const report = x => console.log(x);
function all(list, label) {
  const seen = [];
  const say = (name, value) => report(label + " " + name + " " + JSON.stringify(value) + " " + (Array.isArray(value) ? value.constructor === Array : "-"));
  say("map", list.map((x, i) => x === undefined ? "u" + i : x * 2));
  say("filter", list.filter(x => x !== 2));
  say("some", list.some(x => x === 3));
  say("every", list.every(x => x !== 3));
  say("find", list.find(x => x === undefined || x > 2));
  say("findIndex", list.findIndex(x => x === undefined || x > 2));
  list.forEach((x, i) => { seen.push(i + ":" + x); });
  say("forEach", seen);
  say("reduce", list.reduce((a, x) => a + x, 100));
  say("flatMap", list.flatMap(x => x === 2 ? [] : [x, [x]]));
}
function twice(make, label) { all(make(), label); all(make(), label); }
twice(() => [1, 2, 3], "plain");
twice(() => [1, , 3], "hole");
twice(() => { const l = [1, 2, 3]; delete l[1]; return l; }, "deleted");
twice(() => [], "empty");
twice(() => [1.5, 2, 3], "doubles");
twice(() => ["a", 2, 3], "mixed");
twice(() => Object.freeze([1, 2, 3]), "frozen");
twice(() => { const l = [1, 2, 3]; Object.defineProperty(l, 1, { get() { return 7; }, enumerable: true, configurable: true }); return l; }, "getter");
twice(() => { const l = [1, 2, 3]; l.constructor = { [Symbol.species]: function (n) { return { length: 0, made: n }; } }; return l; }, "own constructor");
twice(() => { const l = [1, 2, 3]; l.constructor = undefined; return l; }, "constructor undefined");
class Below extends Array {}
twice(() => Below.from([1, 2, 3]), "subclass");
class Other extends Array { static get [Symbol.species]() { return Array; } }
twice(() => Other.from([1, 2, 3]), "subclass with species");
twice(() => { const l = [1, 2, 3]; l.map = function () { return "own map"; }; l.some = () => "own some"; return l; }, "own methods");
twice(() => Object.setPrototypeOf([1, 2, 3], { __proto__: Array.prototype, filter() { return "other filter"; } }), "moved");
twice(() => { const l = [1, , 3]; Object.setPrototypeOf(l, { __proto__: Array.prototype, 1: "above" }); return l; }, "element above");
twice(() => { const l = [1, 2, 3]; l.extra = 1; return l; }, "extra name");
twice(() => { const l = []; l[5] = 1; l.length = 7; return l; }, "sparse");
