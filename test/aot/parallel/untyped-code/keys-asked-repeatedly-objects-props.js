// Reflect.ownKeys and Object.getOwnPropertyNames, asked again and again of objects that hold a symbol or a name beside what their constructors give them by name:
// each answer is a list of its own, and it follows whatever was done to the object since the last one.
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
var kMode = Symbol("mode");
if (Reflect.ownKeys.length > 5) kMode = Symbol("never");
var late = JSON.parse('"late"');
function Root(limit) {
  this.events = null;
  this.eventsCount = 0;
  this[kMode] = false;
  this.maxListeners = limit;
}
const library = { Root: function Unused() {} };
library.Root = Root;
const kinds = [];
for (let i = 0; i < 6; i++) {
  const Kind = { ["Kind" + i]: function (limit) { if (i & 1) this.early = i; library.Root.call(this, limit); if (i & 2) this[late + i] = i; this.last = i; } }["Kind" + i];
  Object.setPrototypeOf(Kind.prototype, Root.prototype);
  kinds.push(Kind);
}
const all = object => Reflect.ownKeys(object).map(String).join();
const names = object => Object.getOwnPropertyNames(object).join();
const say = (label, object) => console.log(label + ": " + all(object) + " | " + names(object) + " | " + Object.keys(object).join() + " | " + Object.getOwnPropertySymbols(object).map(String).join());

const said = new Set();
for (let turn = 0; turn < 50; turn++) for (const Kind of kinds) said.add(all(new Kind(turn)) + " | " + names(new Kind(turn)));
console.log([...said].join("\n"));

// What is done to a list stays in that list.
const one = new kinds[3](1);
for (let turn = 0; turn < 6; turn++) {
  const list = Reflect.ownKeys(one);
  const other = Reflect.ownKeys(one);
  console.log(list === other, list.length, Array.isArray(list), Object.isFrozen(list));
  if (turn === 0) list.push("pushed");
  if (turn === 1) list[0] = "stored";
  if (turn === 2) list.length = 1;
  if (turn === 3) list.sort((a, b) => (String(a) < String(b) ? 1 : -1));
  if (turn === 4) list.reverse();
  console.log(list.map(String).join(), "|", other.map(String).join(), "|", all(one));
}
for (let turn = 0; turn < 4; turn++) {
  const list = Object.getOwnPropertyNames(one);
  list.unshift(turn);
  list.pop();
  console.log(list.join(), "|", names(one));
}

// The object changes between two answers.
for (const Kind of kinds) {
  const object = new Kind(2);
  for (let turn = 0; turn < 4; turn++) all(object), names(object);
  say("as made", object);
  object.added = 1;
  say("a name more", object);
  say("again", object);
  say("and again", object);
  const another = Symbol("another");
  object[another] = 2;
  say("a symbol more", object);
  say("again", object);
  say("and again", object);
  delete object[kMode];
  say("the first symbol deleted", object);
  say("again", object);
  say("and again", object);
  object[kMode] = true;
  say("and given again", object);
  say("again", object);
  say("and again", object);
  delete object.eventsCount;
  say("a name of the constructor deleted", object);
  say("again", object);
  say("and again", object);
  object.eventsCount = 3;
  say("and given again", object);
  say("again", object);
  say("and again", object);
  Object.defineProperty(object, "hidden", { value: 1, enumerable: false, configurable: true });
  say("a name that is not enumerable", object);
  say("again", object);
  say("and again", object);
  Object.defineProperty(object, "last", { enumerable: false });
  say("a name of the constructor made not enumerable", object);
  say("again", object);
  say("and again", object);
  Object.defineProperty(object, another, { get() { return 1; }, enumerable: false, configurable: true });
  say("a getter under the symbol", object);
  say("again", object);
  say("and again", object);
  object[7] = "seven";
  say("an index", object);
  say("again", object);
  object[3] = "three";
  say("an index in front of it", object);
  say("again", object);
  say("and again", object);
  delete object[7];
  say("the first index deleted", object);
  say("again", object);
  say("and again", object);
  Object.freeze(object);
  say("frozen", object);
  say("again", object);
  say("and again", object);
}

// Two objects of one kind part ways and meet again.
const left = new kinds[2](3), right = new kinds[2](3);
for (let turn = 0; turn < 4; turn++) console.log(all(left) === all(right), names(left) === names(right));
left.x = 1; left.y = 2;
right.y = 2; right.x = 1;
for (let turn = 0; turn < 4; turn++) console.log(all(left), "|", all(right));
delete left.x; delete right.x;
for (let turn = 0; turn < 4; turn++) console.log(all(left), "|", all(right));

// Collections between the answers.
const kept = kinds.map(Kind => new Kind(4));
for (let turn = 0; turn < 5; turn++) {
  const lists = kept.map(object => Reflect.ownKeys(object));
  collect();
  console.log(lists.map(list => list.map(String).join()).join(" ; ") === kept.map(all).join(" ; "), lists[5].length);
}

// More kinds than anybody keeps lists for.
const many = [];
for (let i = 0; i < 300; i++) {
  const object = new kinds[i % 6](i);
  object["own" + i] = i;
  if (i % 3 === 0) object[Symbol.for("shared" + (i % 7))] = i;
  many.push(object);
}
let length = 0;
const seen = new Set();
for (let turn = 0; turn < 5; turn++) for (const object of many) { const text = all(object) + "|" + names(object); length += text.length; seen.add(text); }
console.log(length, seen.size, all(many[299]), "|", all(many[0]));
