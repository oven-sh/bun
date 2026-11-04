// `object[key]`, where the key names an accessor of the object's own: the place of the key remembers by the Structure in which word the GetterSetter lies, never the getter.
// Each step has an object, a key and a reader of its own, asked 400 times before anything changes and 400 times behind it.
const slot = JSON.parse("[0]");
function through(value) { slot[0] = value; return slot[0]; }
function lay(o, name, tag) { Object.defineProperty(o, name, { get() { return tag + ":" + String(name) + ":" + (this === o ? "own" : "other"); }, enumerable: true, configurable: true }); }
// An object of a literal of the program is a compiled object. The others are ordinary ones.
const blanks = [() => ({}), () => Object.create(null), () => JSON.parse("{}"), new Function("return {}")];
let blank = blanks[0];
function few(tag, key) { const o = blank(); lay(o, key, tag); return o; }
function many(tag, key) { const o = blank(); for (let k = 0; k < 40; k++) lay(o, "n" + k, tag); lay(o, key, tag); return o; }
function read(o, key) { return o[key]; }
function warm(o, key) { let last; for (let i = 0; i < 400; i++) last = read(o, key); return last; }
function attempt(f) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "other error"; } }
function log(...parts) { console.log(parts.join(" | ")); }
const steps = [
  ["another getter", (o, key) => { Object.defineProperty(o, key, { get() { return "another getter"; } }); }],
  ["a value in its place", (o, key) => { Object.defineProperty(o, key, { value: "a value now", writable: true }); }],
  ["deleted", (o, key) => { delete o[key]; }],
  ["a setter alone", (o, key) => { Object.defineProperty(o, key, { get: undefined, set(v) {} }); }],
  ["a getter that throws", (o, key) => { Object.defineProperty(o, key, { get() { throw new RangeError("thrown"); } }); }],
  ["a getter of the host", (o, key) => { Object.defineProperty(o, key, { get: Object.getOwnPropertyDescriptor(Map.prototype, "size").get }); }],
  ["a bound getter", (o, key) => { Object.defineProperty(o, key, { get: function () { return "bound to " + this.tag; }.bind({ tag: "another object" }) }); }],
  ["a name more", (o) => { o.more = 1; }],
  ["a hundred names more", (o) => { for (let k = 0; k < 100; k++) o["m" + k] = k; }],
  ["frozen", (o) => { Object.freeze(o); }],
  ["moved below another", (o) => { Object.setPrototypeOf(o, { above: 1 }); }],
  ["deleted, and one above", (o, key) => { delete o[key]; Object.setPrototypeOf(o, few("above", key)); }],
  ["another name deleted", (o) => { o.spare = 1; delete o.spare; delete o.n3; }],
];
let number = 0;
for (const make of [few, many]) for (blank of blanks) {
  for (const [what, step] of steps) {
    for (const key of [through("size" + number++), Symbol("size")]) {
      const o = through(make(what, key));
      const twin = through(make(what + ", the twin", key));
      log(what + ": before", warm(o, key), read(twin, key));
      step(o, key);
      log(what + ": behind", attempt(() => read(o, key)), attempt(() => read(twin, key)), attempt(() => warm(o, key)), attempt(() => warm(twin, key)));
    }
  }
}
blank = blanks[2];
// One key, objects of several Structures in turns, and receivers that are no such objects.
const shared = through("shared");
const turns = [few("a", shared), many("b", shared), { shared: "plain" }, Object.create(few("c", shared)), [1], "text", 5, new Map()];
let seen = "";
for (let i = 0; i < 1600; i++) { const value = read(through(turns[i % turns.length]), shared); if (i >= 1592) seen += String(value) + " "; }
log("in turns", seen);
// A text that is made anew is another cell with the same letters.
const held = many("made anew", "size");
let same = 0;
for (let i = 0; i < 800; i++) same += read(held, through(["si", "ze"].join(""))) === "made anew:size:own" ? 1 : 0;
log("keys made anew", same);
// The Structures die, and the numbers of those that come next may be theirs.
let sum = 0;
for (let round = 0; round < 6; round++) {
  const key = through("round" + round);
  for (let i = 0; i < 400; i++) sum += read(through(round % 2 ? many(round, key) : few(round, key)), key).length;
  Bun.gc(true);
}
log("collected", sum);
