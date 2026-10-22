// One more element for an array whose vector is full, by `push` and by a store at the length: every storage kind, every length around the steps of the growth, and the arrays whose storage is not a plain vector of their own.
const collect = globalThis.gc ?? (() => Bun.gc(true));
const lines = [];
const hidden = JSON.parse('{"zero":0,"one":1,"half":0.5,"word":"w","limit":140}');

function push(list, value) { list.push(value); return list; }
function storeAtLength(list, value) { list[list.length] = value; return list; }
function append(list, value) { if (list === undefined) return [value]; list.push(value); return list; }

const values = {
  integers: i => i + hidden.zero,
  doubles: i => i + hidden.half,
  strings: i => hidden.word + i,
  objects: i => ({ i }),
  integersThenDoubles: i => (i < 5 ? i : i + hidden.half),
  integersThenStrings: i => (i < 9 ? i : hidden.word + i),
  doublesThenObjects: i => (i < 3 ? i + hidden.half : { i }),
  doublesWithNaN: i => (i === 7 ? NaN : i + hidden.half),
  withUndefined: i => (i % 4 ? i : undefined),
};

function digest(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    text += (i in list ? "" : "hole") + (typeof value === "object" && value !== null ? "{" + value.i + "}" : String(value)) + ",";
  }
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return list.length + ":" + sum;
}

for (const [name, valueAt] of Object.entries(values)) {
  for (const [way, add] of [["push", push], ["store", storeAtLength]]) {
    const seen = [];
    let list = [];
    for (let i = 0; i < hidden.limit; i++) {
      list = add(list, valueAt(i));
      if (i < 12 || i % 16 > 13) seen.push(digest(list));
    }
    lines.push(name + " " + way + " " + digest(seen) + " " + digest(list));
  }
  let list;
  for (let i = 0; i < 40; i++) list = append(list, valueAt(i));
  lines.push(name + " append " + digest(list));
}

function tell(name, make) {
  for (const [way, add] of [["push", push], ["store", storeAtLength]]) {
    let outcome;
    try {
      const list = make();
      for (let i = 0; i < 20; i++) add(list, i + hidden.one);
      outcome = digest(list) + " " + Object.keys(list).length + " " + Object.getPrototypeOf(list).constructor.name;
    } catch (error) {
      outcome = error.constructor.name;
    }
    lines.push(name + " " + way + " " + outcome);
  }
}

class Stack extends Array {}
tell("named property", () => { const list = [1]; list.tag = "t"; return list; });
tell("many named properties", () => { const list = [1, 2, 3]; for (let i = 0; i < 9; i++) list["p" + i] = i; return list; });
tell("subclass", () => Stack.of(1, 2, 3));
tell("constant literal", () => [1, 2, 3]);
tell("constant literal of doubles", () => [1.5, 2.5, 3.5]);
tell("constant literal of strings", () => ["a", "b", "c"]);
tell("shifted", () => { const list = [1, 2, 3, 4, 5, 6, 7]; list.shift(); list.shift(); return list; });
tell("unshifted", () => { const list = [3]; list.unshift(1, 2); return list; });
tell("emptied", () => { const list = [1, 2, 3]; list.length = 0; return list; });
tell("shortened", () => { const list = [1, 2, 3, 4, 5, 6, 7]; list.length = 2; return list; });
tell("popped", () => { const list = [1, 2, 3]; list.pop(); list.pop(); list.pop(); return list; });
tell("with a hole", () => { const list = [1, , 3]; return list; });
tell("of a given length", () => new Array(3));
tell("of length zero", () => new Array(0));
tell("sparse", () => { const list = [1]; list[100000] = 2; return list; });
tell("frozen", () => Object.freeze([1, 2, 3]));
tell("sealed", () => Object.seal([1, 2, 3]));
tell("not extensible", () => Object.preventExtensions([1, 2, 3]));
tell("read-only length", () => Object.defineProperty([1, 2, 3], "length", { writable: false }));
tell("other prototype", () => Object.setPrototypeOf([1, 2, 3], { constructor: { name: "Other" }, push: Array.prototype.push }));
tell("sliced", () => [1, 2, 3, 4, 5].slice(1, 4));
tell("mapped", () => [1, 2, 3].map(x => x + hidden.half));
tell("keys of an object", () => Object.keys({ a: 1, b: 2, c: 3 }));
tell("parsed", () => JSON.parse("[1,2,3]"));
tell("split", () => "a,b,c".split(","));
tell("array-like", () => ({ length: 3, 0: 1, 1: 2, 2: 3, push: Array.prototype.push }));

{
  const old = [];
  const oldDoubles = [];
  const oldObjects = [];
  for (let round = 0; round < 12; round++) {
    for (let i = 0; i < 3; i++) {
      push(old, round * 3 + i);
      storeAtLength(oldDoubles, round + i + hidden.half);
      push(oldObjects, { i: round * 3 + i });
    }
    collect();
  }
  lines.push("across collections " + digest(old) + " " + digest(oldDoubles) + " " + digest(oldObjects));
}

{
  const holder = { lists: [] };
  collect();
  for (let round = 0; round < 6; round++) {
    const young = [];
    holder.lists.push(young);
    for (let i = 0; i < 4 + round * 5; i++) push(young, { i: round + i });
    collect();
    for (const list of holder.lists) storeAtLength(list, { i: round });
  }
  lines.push("grown, then collected " + holder.lists.map(digest).join(" "));
}

{
  const shared = [1];
  const alias = shared;
  for (let i = 0; i < 30; i++) (i % 2 ? push(shared, i) : storeAtLength(alias, i));
  lines.push("aliases " + (shared === alias) + " " + digest(alias));
}

{
  let kept = 0;
  for (let round = 0; round < 20000; round++) {
    let list;
    for (let i = 0; i < (round & 15); i++) list = append(list, { i });
    if (list) kept += list.length + list[list.length - 1].i;
  }
  lines.push("many short lists " + kept);
}

console.log(lines.join("\n"));
