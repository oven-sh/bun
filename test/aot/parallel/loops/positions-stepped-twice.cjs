// Iterations that step a field twice, once or not at all: what each way leaves in it meets, and a step past the largest 32-bit integer undoes the iteration.
// STATISTIC: CarriedSlotsMergedAtJoins >= 2
// STATISTIC: CarriedFieldStepsGuarded >= 4
(function () {
const turns = JSON.parse("300"), KEY = JSON.parse('"at"'), box = {}, SLOT = JSON.parse('"slot"');
const unknown = s => { box[SLOT] = s; return box[SLOT]; };
class Cursor {
  reset(at, limit) { this.at = at; this.limit = limit; this.lines = 0; this.start = 0; this.other = null; return this; }
}
class Scanner {
  constructor(text) { this.text = text; this.cursor = new Cursor(); this.cursor.reset(0, 0); }
  skip() {
    while (this.cursor.at < this.text.length) {
      const unit = this.text.charCodeAt(this.cursor.at);
      if (unit === 13) { if (this.text.charCodeAt(this.cursor.at + 1) === 10) ++this.cursor.at; ++this.cursor.at; ++this.cursor.lines; this.cursor.start = this.cursor.at; }
      else if (unit === 10) { ++this.cursor.at; ++this.cursor.lines; this.cursor.start = this.cursor.at; }
      else if (unit === 32) ++this.cursor.at;
      else break;
    }
    return this.cursor.at;
  }
  // The text is read through a number's bits, so that positions may grow past any length.
  walk(bits, most) {
    let done = 0;
    while (this.cursor.at < this.cursor.limit) {
      if (done === most) break;
      const bit = bits >> (done & 15) & 3;
      if (bit === 3) { ++this.cursor.at; ++this.cursor.lines; ++this.cursor.at; }
      else if (bit === 2) this.cursor.at += 1;
      else if (bit === 1) { this.cursor.at += 2; this.cursor.at -= 1; }
      ++done;
    }
    return done;
  }
  // A store through another object of the class.
  walkBoth(most) {
    let done = 0;
    const other = this.cursor.other;
    while (this.cursor.at < this.cursor.limit) {
      if (done === most) break;
      if (done & 1) ++this.cursor.at;
      other.at = done;
      ++done;
    }
    return done;
  }
}
const texts = ["  \r\n\n x", "\r\r\n \n\r", "", "x", "\r", "\r\n", " ".repeat(40) + "\n".repeat(9) + "\r\n".repeat(7) + "y", "  中\r\n"];
for (const text of texts) { const s = new Scanner(text); console.log(s.skip(), s.cursor.lines, s.cursor.start); }
let sum = 0; for (let t = 0; t < turns; t++) { const s = new Scanner(" ".repeat(t & 7) + "\r\n".repeat(t % 5) + "\n \n" + t); sum += s.skip() + s.cursor.lines * 3 + s.cursor.start; }
for (let t = 0; t < turns; t++) { const s = new Scanner(""); s.cursor.reset(t, t + 50); sum += s.walk(t, 80) + s.cursor.at + s.cursor.lines; }
console.log(sum);
const max = 2 ** 31 - 1;
for (const [at, limit] of [[0, 20], [-9, 9], [max - 1, max + 9], [max, max + 9], [max - 2, max], [max - 5, 2 ** 40], [0.5, 9], [-0, 5], [2 ** 53 - 3, 2 ** 53 + 9], ["5", 9], [null, 5], [1n, 5n], [undefined, 9]]) for (const bits of [0xffff, 0x5b1b, 0xe4e4, 0x1]) {
  const s = new Scanner(""); s.cursor.reset(0, 0); Object.assign(unknown(s.cursor), { at, limit }); let said; try { said = s.walk(bits, 12); } catch (e) { said = e.constructor.name; }
  console.log(String(at), bits, said, String(s.cursor.at), Object.is(s.cursor.at, -0), typeof s.cursor.at, s.cursor.lines);
}
const changes = [s => Object.freeze(s), s => { delete s[KEY]; }, s => { let held = 0; Object.defineProperty(s, KEY, { get() { return held; }, set(v) { if (v === 3) throw new RangeError("three"); held = v; } }); }, s => Object.defineProperty(s, KEY, { value: 0, writable: false }), s => Object.setPrototypeOf(s, null), s => { s[KEY] = { valueOf() { return 1; } }; }];
for (const change of changes) {
  const s = new Scanner(" \r\n  \nz"); s.cursor.limit = 9; let said;
  try { change(unknown(s.cursor)); said = s.skip() + " " + s.walk(0x1b, 5); } catch (e) { said = e.constructor.name + (e.message === "three" ? " three" : ""); }
  console.log(said, String(s.cursor.at), s.cursor.lines);
}
const seen = []; const proxied = new Scanner(" \r\n x"); proxied.cursor = new Proxy(proxied.cursor, { get(t, k) { seen.push("g" + String(k)); return t[k]; }, set(t, k, v) { seen.push("s" + String(k)); t[k] = v; return true; } });
console.log(proxied.skip(), seen.join());
for (const same of [false, true]) { const s = new Scanner(""); s.cursor.reset(0, 30); s.cursor.other = same ? s.cursor : new Cursor().reset(0, 0); console.log(s.walkBoth(25), s.cursor.at, s.cursor.other.at); }
let both = 0; for (let t = 0; t < turns; t++) { const s = new Scanner(""); s.cursor.reset(t, t + 20); s.cursor.other = t % 50 === 7 ? s.cursor : new Cursor().reset(0, 0); both += s.walkBoth(30) + s.cursor.at; }
console.log(both);
})();
