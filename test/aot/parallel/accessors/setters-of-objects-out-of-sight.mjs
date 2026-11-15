// Objects that nobody knows ahead take stores through the setters of their literals, until somebody changes the accessor.
const log = [], list = JSON.parse("[0, 0, 0, 0, 0, 0]");
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
function storeSloppy(object, value) { return (0, eval)("(object, value) => { object.size = value; }")(object, value); }
function store(object, value) { object.size = value; }
function storeUnder(object, name, value) { object[name] = value; }
function rounds(object) {
  let sum = 0;
  for (let i = 0; i < 60; i++) {
    object.size = i & 7;
    storeUnder(object, i & 1 ? "size" : "v", i & 3);
    sum += Number(object.size) + Number(object.v);
  }
  return sum;
}
list[0] = { v: 1, get size() { return this.v; }, set size(x) { this.v = x * 2; } };
list[1] = { v: 2, get size() { return this.v; } };
list[2] = { v: 3, set size(x) { this.v = x + 1; } };
list[3] = { v: 4, get size() { return this.v; }, set size(x) { if (x === 5) throw new RangeError("five"); this.v = x; } };
list[4] = { v: 5, size: 6 };
list[5] = { v: 6 };
Object.defineProperty(list[5], "size", { get() { return this.v; }, set(x) { this.v = -x; }, configurable: true, enumerable: true });
for (const object of list) log.push(attempt(() => rounds(object)), object.v, object.size, Object.keys(object).join());
for (const object of list) {
  for (const value of [1, "two", undefined, 5]) log.push(attempt(() => store(object, value)), attempt(() => storeSloppy(object, value)), String(object.v));
}
function turns(object, change) {
  let text = "";
  for (let i = 0; i < 12; i++) {
    if (i === 6) text += attempt(() => change(object)) + " ";
    text += attempt(() => { object.size = i; return object.v; }) + " ";
  }
  return text;
}
const make = () => { const made = JSON.parse("[0]"); made[0] = { v: 0, get size() { return this.v; }, set size(x) { this.v = x + 1; } }; return made[0]; };
log.push(turns(make(), object => Object.defineProperty(object, "size", { set(x) { this.v = "again" + x; } })));
log.push(turns(make(), object => Object.defineProperty(object, "size", { value: 4, writable: true })));
log.push(turns(make(), object => delete object.size));
log.push(turns(make(), object => Object.defineProperty(object, "size", { set: undefined })));
log.push(turns(make(), object => Object.freeze(object)));
log.push(turns(make(), object => Object.setPrototypeOf(object, { set size(x) { this.v = "above"; } })));
log.push(turns(make(), object => { object.extra = 1; object.other = 2; }));
const heir = Object.create(make());
log.push(turns(heir, object => { Object.defineProperty(Object.getPrototypeOf(object), "size", { set(x) { this.v = "heir" + x; } }); }));
const handed = make();
let depth = 0;
Object.defineProperty(handed, "size", { get() { return this.v; }, set(x) { if (depth++ < 3) this.size = x * 2; this.v = [x, this.v].join(); depth--; } });
for (let i = 0; i < 4; i++) handed.size = i;
log.push(handed.v.length, handed.v.slice(0, 40));
console.log(log.join("\n"));
