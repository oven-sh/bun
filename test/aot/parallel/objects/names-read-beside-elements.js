// An object that serves as a table has names and, among them, a few keys that spell an index. Each key is made at run time and looked for once.
function keysOf(count) {
  const keys = [];
  for (let i = 0; i < count; i++) keys.push((i % 7 === 3 ? "" : "k") + i.toString(i % 5 === 0 ? 10 : 36));
  return keys;
}
function fill(table, keys) {
  for (let i = 0; i < keys.length; i++) table[keys[i]] = i;
  return table;
}
function sumOf(table, keys) {
  let sum = 0;
  let missing = 0;
  for (let i = 0; i < keys.length; i++) {
    const found = table[keys[i]];
    if (found === undefined) missing++;
    else sum += found;
  }
  return sum + ":" + missing;
}
function presentIn(table, keys) {
  let own = 0;
  let any = 0;
  for (let i = 0; i < keys.length; i++) {
    if (Object.hasOwn(table, keys[i])) own++;
    if (keys[i] in table) any++;
  }
  return own + ":" + any;
}
const keys = keysOf(400);
const others = keysOf(800).slice(400).concat(["0", "00", "01", "1e3", "-1", "4294967294", "4294967295", "4294967296", "１", "٣", "İ", "", " 1", "1 "]);

const bare = fill(Object.create(null), keys);
console.log(sumOf(bare, keys), sumOf(bare, others), presentIn(bare, keys), presentIn(bare, others));

const plain = fill({}, keys);
console.log(sumOf(plain, keys), sumOf(plain, others), presentIn(plain, keys), presentIn(plain, others));

// The names lie above the object that is asked, and both have elements.
const below = Object.create(plain);
below[7] = "seven";
below.own = 1;
console.log(sumOf(below, keys), sumOf(below, others), presentIn(below, keys), presentIn(below, others), below["7"], below["own"]);

// A function object with members under names and under indexes.
function status(code) {
  return status[code];
}
for (const [code, text] of [[200, "OK"], [404, "Not Found"], [500, "Internal Server Error"]]) {
  status[code] = text;
  status[text.toLowerCase()] = code;
}
console.log(["200", "404", "ok", "not found", "internal server error", "201", "gone", "length", "name"].map(key => String(status[key])).join("|"));

// An object of a class with members that the class does not declare.
class Record {
  constructor(id) {
    this.id = id;
  }
}
const record = fill(new Record(1), keys.slice(0, 40));
console.log(sumOf(record, keys.slice(0, 40)), sumOf(record, others), presentIn(record, keys.slice(0, 40)), record["id"], record["3"], record["k1"]);

// Names of characters of 16 bits whose low half is a digit, and symbols with such descriptions.
const wide = Object.create(null);
wide[5] = "five";
for (const name of ["İ", "ı1", "İı", "ȵ", "〱"]) wide[name] = name.length;
const marks = [Symbol("1"), Symbol("a"), Symbol(""), Symbol()];
marks.forEach((mark, index) => (wide[mark] = index));
console.log(["İ", "ı1", "İı", "ȵ", "〱", "ĵ", "5", "05"].map(name => String(wide[name])).join("|"), marks.map(mark => wide[mark]).join("|"), wide[Symbol("1")]);

// An element that is an accessor, and a name beside it.
const watched = { label: "watched" };
Object.defineProperty(watched, "2", { get() { return this.label + "!"; }, enumerable: true });
console.log(["label", "2", "02", "3"].map(key => String(watched[key])).join("|"));

// A name is taken away and given again while the elements stay.
delete bare[keys[1]];
console.log(bare[keys[1]], keys[1] in bare, bare[keys[3]], bare[keys[2]]);
bare[keys[1]] = "again";
console.log(bare[keys[1]], keys[1] in bare);
