// One store site per name adds named properties to objects that also hold elements, so the named storage grows beside the elements at the first, fifth and ninth name.
const names = ["pos", "end", "flags", "kind", "parent", "id", "text", "next", "last", "extra"];
function addByName(list, value) {
  list.pos = value; list.end = value + 1; list.flags = value + 2; list.kind = value + 3; list.parent = value + 4;
  list.id = value + 5; list.text = value + 6; list.next = value + 7; list.last = value + 8; list.extra = value + 9;
  return list;
}
function addByKey(list, value) {
  for (let i = 0; i < names.length; i++) list[names[i]] = value + i;
  return list;
}
function show(list) {
  const named = names.map(name => list[name]).join();
  return `${Array.isArray(list)} ${list.length} [${Array.prototype.join.call(list)}] ${named} ${Object.keys(list).join()}`;
}
class List extends Array {}
const creators = {
  integers: round => [round, round + 1, round + 2],
  doubles: round => [round + 0.5, round + 1.5],
  texts: round => ["a" + round, "b" + round],
  empty: () => [],
  holes: round => { const list = [round]; list[3] = round; return list; },
  long: round => { const list = []; for (let i = 0; i < 100; i++) list.push(i + round); return list.slice(0, 40); },
  sparse: round => { const list = [round]; list[100000] = round; return list; },
  parsed: round => JSON.parse(`[${round},${round}]`),
  constants: () => [1, 2, 3],
  subclass: round => List.of(round, round),
  object: round => ({ 0: round, 1: round, length: 2 }),
  shifted: round => { const list = [0, round, round]; list.shift(); return list; },
};
for (const [kind, create] of Object.entries(creators)) {
  for (let round = 1; round <= 4; round++) {
    console.log(kind, round, "by name", show(addByName(create(round), round * 10)));
    console.log(kind, round, "by key", show(addByKey(create(round), round * 10)));
  }
}

function addOne(list, value) { list.mark = value; return list.mark; }
function tryAddOne(list, value) { try { list.mark = value; return list.mark; } catch (error) { return error.constructor.name; } }
for (let round = 1; round <= 4; round++) {
  console.log("plain", addOne([round], round), tryAddOne([round], round));
  console.log("not extensible", tryAddOne(Object.preventExtensions([round]), round));
  console.log("sealed", tryAddOne(Object.seal([round]), round));
  console.log("frozen", tryAddOne(Object.freeze([round]), round));
  const prototype = [round];
  const derived = Object.create(prototype);
  console.log("prototype", addOne(prototype, round), derived.mark, addOne(derived, -round), prototype.mark, Object.keys(derived).join());
}

const stored = [];
const base = [];
for (let round = 1; round <= 6; round++) {
  if (round === 4) {
    Object.defineProperty(List.prototype, "mark", { set(value) { stored.push(value); }, get() { return "inherited"; }, configurable: true });
    Object.defineProperty(base, "mark", { set(value) { stored.push(-value); }, get() { return "from base"; }, configurable: true });
  }
  const list = List.of(round, round);
  const below = Object.setPrototypeOf([round, round], base);
  console.log("setter above", round, addOne(list, round), Object.keys(list).join(), list.length, addOne(below, round), Object.keys(below).join(), below.length);
}
delete List.prototype.mark;
console.log(stored.join(), addOne(List.of(7), 7));

let kept = [];
for (let round = 0; round < 20000; round++) {
  const list = addByName([round, round + 0.5, "t" + round], round);
  if (round % 1000 === 0) kept.push(list);
}
console.log(kept.map(list => `${list[0]} ${list[1]} ${list[2]} ${list.pos} ${list.extra}`).join("|"));
