// Positions of a class that writes no types: steps and whole constants fill them, loops compare them. Code out of sight stores what is no int32, and steps pass 2 ** 31.
// STATISTIC: FieldTypesEnforced >= 1
class Scanner {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.line = 1;
    this.depth = 0;
  }
  skip() {
    while (this.pos < this.text.length) {
      const c = this.text.charCodeAt(this.pos);
      if (c === 32) ++this.pos;
      else if (c === 10) {
        ++this.pos;
        ++this.line;
      } else if (c === 47 && this.text.charCodeAt(this.pos + 1) === 47) {
        this.pos += 2;
        while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 10) ++this.pos;
      } else break;
    }
  }
  next() {
    this.skip();
    const start = this.pos;
    if (this.pos >= this.text.length) return "";
    const c = this.text.charCodeAt(this.pos);
    if (c === 40) this.depth++;
    if (c === 41 && this.depth > 0) this.depth--;
    if (c >= 97 && c <= 122) while (this.pos < this.text.length && this.text.charCodeAt(this.pos) >= 97) this.pos++;
    else ++this.pos;
    return this.text.slice(start, this.pos);
  }
  all(limit) {
    let out = "";
    for (let token = this.next(); token && limit-- > 0; token = this.next()) out += token + (this.line > 1 ? "|" : ",");
    return out;
  }
}
const unseen = (0, eval)(Buffer.from("KHsgc3RvcmUobywgbiwgdikgeyBvW25dID0gdiB9LCByZW1vdmUobywgbikgeyBkZWxldGUgb1tuXSB9IH0p", "base64").toString());
globalThis.kept = { Scanner, unseen };
const text = "let a = (b + c) // note\nif (a) (d)\n// end\nlast";
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "{}" : String(v));
const state = s => `${show(s.pos)} ${show(s.line)} ${show(s.depth)} ${Object.keys(s)}`;
const tell = (what, f) => {
  let said;
  try { said = f(); } catch (e) { said = e.constructor.name; }
  console.log(what, said);
};
tell("plain", () => { const s = new Scanner(text); return s.all(100) + state(s); });
const values = [2, 0.5, -0, NaN, 2147483647, 2147483648, -2147483648, -2147483645, 2 ** 53, "3", "x", true, null, undefined, {}];
for (const name of ["pos", "line", "depth"])
  for (const value of values)
    tell(`${name} ${show(value)}`, () => {
      const s = new Scanner(text);
      const first = s.all(3);
      unseen.store(s, name, value);
      const middle = state(s) + s.all(4) + state(s);
      unseen.store(s, name, 7);
      return first + middle + s.all(2) + state(s) + JSON.stringify(s).length;
    });
tell("wide", () => {
  const s = new Scanner(text);
  unseen.store(s, "line", 2147483646);
  const out = s.all(100);
  for (let i = 0; i < 5; i++) ++s.line;
  return out + state(s) + (s.line > 2147483647);
});
tell("removed", () => { const s = new Scanner(text); unseen.remove(s, "line"); const out = s.all(100) + state(s); unseen.store(s, "line", 4); s.pos = 0; return out + s.all(100) + state(s); });
tell("copied", () => { const s = new Scanner(text); s.all(5); return state(Object.assign(new Scanner("x"), s)) + state({ ...s }) + state(Object.assign({}, s)); });
class Deep extends Scanner { constructor(text) { super(text); this.own = 0; } next() { this.own++; return super.next(); } }
tell("heir", () => { const s = new Deep(text); return s.all(100) + state(s) + s.own; });
