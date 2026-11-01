// Object.groupBy over a list runs its loop without an iterator, and sees what a callback does to the list as the iterator would.
function show(groups) {
  return JSON.stringify(Object.keys(groups).map(key => [key, groups[key]])) + " " + (Object.getPrototypeOf(groups) === null);
}
const people = [{ team: "a", n: 1 }, { team: "b", n: 2 }, { team: "a", n: 3 }];
let sum = 0;
for (let i = 0; i < 20000; i++) {
  const teams = Object.groupBy(people, person => person.team);
  sum = (sum + teams.a.length + teams.b[0].n) % 1000003;
}
console.log(sum, show(Object.groupBy(people, (person, index) => person.team + (index % 2))));
function attempt(name, run) {
  try {
    console.log(name, show(run()));
  } catch (error) {
    console.log(name, "threw", error.constructor.name, error.message);
  }
}
attempt("indexes", () => Object.groupBy(["x", "y", "z"], (item, index) => index));
attempt("holes", () => Object.groupBy([1, , 3], item => String(item)));
attempt("hole over the prototype", () => {
  const list = [1, , 3];
  Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: "up" } }));
  return Object.groupBy(list, item => String(item));
});
attempt("grows", () => {
  const list = [1, 2];
  return Object.groupBy(list, item => { if (list.length < 5) list.push(item + 10); return "all"; });
});
attempt("shrinks", () => {
  const list = [1, 2, 3, 4];
  return Object.groupBy(list, item => { list.length = 2; return "all"; });
});
attempt("empties", () => {
  const list = [1, 2, 3];
  return Object.groupBy(list, item => { list.length = 0; return "all"; });
});
attempt("kinds", () => Object.groupBy([1, 2.5, "s", null, undefined, true], item => typeof item));
attempt("symbol keys", () => {
  const mark = Symbol("mark");
  const groups = Object.groupBy([1, 2], () => mark);
  return { lengths: groups[mark].length, ...Object.groupBy([1], () => "x") };
});
attempt("__proto__ key", () => Object.groupBy([1], () => "__proto__"));
attempt("constructor key", () => Object.groupBy([1, 2], () => "constructor"));
attempt("object key", () => Object.groupBy([1], () => ({ toString() { return "from toString"; } })));
attempt("callback throws", () => Object.groupBy([1], () => { throw new RangeError("from a callback"); }));
attempt("key throws", () => Object.groupBy([1], () => ({ toString() { throw new RangeError("from a key"); } })));
attempt("no callback", () => Object.groupBy([1]));
attempt("null", () => Object.groupBy(null, () => 1));
attempt("number", () => Object.groupBy(5, () => 1));
attempt("string", () => Object.groupBy("aba", item => item));
attempt("set", () => Object.groupBy(new Set([1, 2]), item => item % 2));
attempt("generator", () => Object.groupBy((function* () { yield 1; yield 2; })(), item => item));
attempt("typed array", () => Object.groupBy(new Uint8Array([1, 2]), item => item));
attempt("not callable", () => {
  const list = [1];
  list[Symbol.iterator] = 5;
  return Object.groupBy(list, item => item);
});
attempt("another iterator", () => {
  const list = [1, 2];
  list[Symbol.iterator] = function* () { yield "own"; };
  return Object.groupBy(list, item => item);
});
attempt("iterator of an object", () => Object.groupBy({ *[Symbol.iterator]() { yield 7; } }, item => item));
attempt("values on an object", () => {
  const like = { 0: "a", length: 1, [Symbol.iterator]: Array.prototype.values };
  return Object.groupBy(like, item => item);
});
attempt("class below Array", () => {
  class List extends Array {}
  return Object.groupBy(List.of(1, 2), item => item);
});
attempt("own values of a class below Array", () => {
  class List extends Array { *[Symbol.iterator]() { yield "mine"; } }
  return Object.groupBy(List.of(1, 2), item => item);
});
attempt("frozen", () => Object.groupBy(Object.freeze([1, 2]), item => item));
attempt("getter element", () => {
  const list = [1, 2];
  Object.defineProperty(list, 0, { get() { return "got"; } });
  return Object.groupBy(list, item => item);
});
attempt("return of the iterator", () => {
  let closed = 0;
  const iterable = { [Symbol.iterator]() { return { next() { return { value: 1, done: false }; }, return() { closed++; return {}; } }; } };
  try {
    Object.groupBy(iterable, () => { throw new Error("stop"); });
  } catch {}
  return { closed };
});
attempt("a getter of the iterator on the list", () => {
  let asked = 0;
  const list = [1, 2];
  Object.defineProperty(list, Symbol.iterator, { get() { asked++; return Array.prototype.values; } });
  return { groups: Object.keys(Object.groupBy(list, item => item)).length, asked };
});
attempt("a getter of the iterator in a class", () => {
  let asked = 0;
  class List extends Array { get [Symbol.iterator]() { asked++; return Array.prototype.values; } }
  return { groups: Object.keys(Object.groupBy(List.of(1, 2), item => item)).length, asked };
});
attempt("a getter of the iterator between", () => {
  let asked = 0;
  const between = Object.create(Array.prototype, { [Symbol.iterator]: { get() { asked++; return Array.prototype.values; } } });
  return { groups: Object.keys(Object.groupBy(Object.setPrototypeOf([1, 2], between), item => item)).length, asked };
});
