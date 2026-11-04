// A call of a built-in's method is compiled behind a look at its receiver. Each function first sees lists as they are made, and at the very next call one that is not.
const log = [];
const show = (label, make) => {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = `${error.constructor.name}: ${error.message}`;
  }
  console.log(label, typeof answer === "object" && answer !== null ? JSON.stringify(answer) : String(answer), log.splice(0).join(","));
};

function joinedAtOnce(list) { return list.join("-"); }
function joined(list) { return list.join("-") + "!"; }
function slicedAtOnce(list) { return list.slice(1); }
function sliced(list) { return list.slice(1).length + 1; }
function pushed(list, value) { return list.push(value) + 1; }
function included(list, value) { return list.includes(value) ? "yes" : "no"; }
function mapped(list, change) { return list.map(change); }
function filtered(list, keep) { return list.filter(keep); }
function concatenated(list, other) { return list.concat(other); }

class Below extends Array {
  join() { return "join of the class below"; }
  slice() { return ["slice of the class below"]; }
  push() { return 40; }
  includes() { return true; }
}

const receivers = {
  asMade: () => [1, 2, 3],
  ownMember: () => {
    const list = [1, 2, 3];
    for (const name of ["join", "slice", "push", "includes", "map", "filter", "concat"])
      list[name] = function (...given) { log.push(`own ${name}`); return name === "push" ? 10 : [name]; };
    return list;
  },
  classBelow: () => Below.from([1, 2, 3]),
  otherPrototype: () => Object.setPrototypeOf([1, 2, 3], {
    join() { return "join above"; }, slice() { return ["slice above"]; }, push() { return 20; }, includes() { return false; },
    map() { return "map above"; }, filter() { return "filter above"; }, concat() { return "concat above"; },
  }),
  noPrototype: () => Object.setPrototypeOf([1, 2, 3], null),
  arrayLike: () => ({ length: 2, 0: "a", 1: "b", join: Array.prototype.join, slice: Array.prototype.slice, push: Array.prototype.push, includes: Array.prototype.includes, map: Array.prototype.map, filter: Array.prototype.filter, concat: Array.prototype.concat }),
  frozen: () => Object.freeze([1, 2, 3]),
  holes: () => [1, , 3],
  accessor: () => Object.defineProperty([1, 2, 3], 1, { get() { log.push("getter"); return "got"; }, enumerable: true, configurable: true }),
  text: () => "abc",
  nothing: () => undefined,
};

for (const [name, make] of Object.entries(receivers)) {
  for (let turn = 0; turn < 3; turn++) {
    joinedAtOnce([1, 2]); joined([1, 2]); slicedAtOnce([1, 2]); sliced([1, 2]); pushed([1], 2); included([1], 1);
    mapped([1, 2], x => x + 1); filtered([1, 2], x => x > 1); concatenated([1], [2]);
  }
  show(`${name} join at once`, () => joinedAtOnce(make()));
  show(`${name} join`, () => joined(make()));
  show(`${name} slice at once`, () => slicedAtOnce(make()));
  show(`${name} slice`, () => sliced(make()));
  show(`${name} push`, () => pushed(make(), 4));
  show(`${name} includes`, () => included(make(), 3));
  show(`${name} map`, () => mapped(make(), x => x + 1));
  show(`${name} filter`, () => filtered(make(), x => x !== 2));
  show(`${name} concat`, () => concatenated(make(), [9]));
}

// What the species look gives is a list that somebody else holds too.
function withSpecies(result) {
  const list = [1, 2, 3];
  list.constructor = { [Symbol.species]: function (length) { log.push(`species ${length}`); return result; } };
  return list;
}
{
  const shared = [];
  show("shared list frozen on the way", () => mapped(withSpecies(shared), (x, i) => { if (i === 1) Object.freeze(shared); return x * 2; }));
  console.log(JSON.stringify(shared));
}
{
  const shared = [];
  show("accessor laid on the way", () => mapped(withSpecies(shared), (x, i) => {
    if (!i) Object.defineProperty(shared, 1, { get() { return "getter"; }, set() { log.push("setter ran"); }, configurable: true });
    return x * 2;
  }));
  console.log(JSON.stringify(Object.getOwnPropertyDescriptor(shared, 1)));
}
show("species gives an object", () => mapped(withSpecies({ length: 0 }), x => x * 2));
show("species gives a list of a class below", () => mapped(withSpecies(new Below()), x => x * 2).constructor.name);
show("species of a class below", () => mapped(Below.from([1, 2]), x => x * 2).constructor.name);
show("filter with species", () => filtered(withSpecies({}), x => x > 1));
show("a long list of holes", () => { const list = []; list.length = 5; list[4] = 1; return mapped(list, x => x + 1); });
