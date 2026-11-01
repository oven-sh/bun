// Objects of a literal or a class are given names that their makers do not spell, and all of it is read under keys held in variables, over and over, while the objects change.
function make(listener) {
  return { __proto__: null, finish: listener };
}
class Holder {
  constructor(id) {
    this.id = id;
    this.kind = "holder";
  }
}
function read(object, key) {
  return object[key];
}
function has(object, key) {
  return key in object;
}
function show(label, object, keys) {
  const found = [];
  for (let round = 0; round < 3; round++) for (const key of keys) found.push(String(read(object, key)) + (has(object, key) ? "+" : "-"));
  const once = found.slice(0, keys.length).join(" ");
  console.log(label, once, found.slice(keys.length, 2 * keys.length).join(" ") === once && found.slice(2 * keys.length).join(" ") === once);
}
const keys = JSON.parse('["finish","end","error","close","drain","id","kind","missing"]');

const events = make("f");
show("as made", events, keys);
events[keys[1]] = "e1";
show("one more", events, keys);
events[keys[2]] = "e2";
events[keys[3]] = "e3";
show("three more", events, keys);
events[keys[2]] = "e2 again";
show("replaced", events, keys);
delete events[keys[1]];
show("first one gone", events, keys);
events[keys[4]] = "e4";
events[keys[1]] = "e1 back";
show("given again", events, keys);

// Two objects of one maker with the same names in another order.
const left = make("l");
const right = make("r");
for (const key of ["end", "error", "close"]) left[key] = "l " + key;
for (const key of ["close", "error", "end"]) right[key] = "r " + key;
for (let round = 0; round < 3; round++) console.log(keys.slice(0, 4).map(key => read(left, key) + "|" + read(right, key)).join(" "));

// Instances of a class, with many names: the later ones lie outside the cell of what holds them.
const holders = [];
for (let n = 0; n < 4; n++) {
  const holder = new Holder(n);
  for (let i = 0; i < 5 + 30 * n; i++) holder["extra" + i] = n * 1000 + i;
  holders.push(holder);
}
const extras = [];
for (let i = 0; i < 100; i += 7) extras.push("extra" + i);
for (let round = 0; round < 3; round++) console.log(holders.map(holder => extras.map(key => read(holder, key) ?? "_").join()).join(" ; ").length, read(holders[3], "extra91"), read(holders[1], "extra28"), read(holders[0], "extra7"), read(holders[2], "id"), read(holders[2], "kind"));

// Hundreds of names, some taken away: what holds them keeps its shape while names go.
const crowded = new Holder(9);
for (let i = 0; i < 400; i++) crowded["n" + i] = i;
const asked = ["n0", "n1", "n199", "n200", "n399", "n400"];
show("crowded", crowded, asked);
delete crowded.n1;
delete crowded.n200;
show("two gone", crowded, asked);
crowded.n400 = 400;
crowded.n1 = "back";
show("two given", crowded, asked);

// An accessor and a name that is not written anew beside the fields.
const guarded = new Holder(3);
Object.defineProperty(guarded, "computed", { get() { return this.id * 2; }, configurable: true, enumerable: true });
Object.defineProperty(guarded, "fixed", { value: "fixed", writable: false, configurable: true });
show("guarded", guarded, ["computed", "fixed", "id"]);
Object.defineProperty(guarded, "computed", { value: "plain now", writable: true, configurable: true });
show("accessor replaced", guarded, ["computed", "fixed", "id"]);

// For another receiver, and from above.
const below = Object.create(events);
below.own = 1;
show("from above", below, keys.concat(["own"]));
console.log(Reflect.get(events, keys[3], below), Reflect.get(guarded, "fixed", events));

// Collections in between, and keys that are made anew.
let sum = 0;
for (let turn = 0; turn < 3000; turn++) {
  const table = make(turn);
  table["end"] = turn + 1;
  table["er" + "ror".slice(0, 3)] = turn + 2;
  sum += read(table, keys[turn % 3]) + read(table, ["finish", "end", "error"][(turn + 1) % 3]);
  if (turn % 1000 === 999) Bun.gc(true);
}
console.log(sum);
