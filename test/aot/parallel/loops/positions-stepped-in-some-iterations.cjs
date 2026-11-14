// A loop that reads this.state.position in every iteration and steps it by one or two in some of them carries the position as a 32-bit integer.
// STATISTIC: CarriedFieldStepsGuarded >= 1
(function () {
const turns = JSON.parse("400"), KEY = JSON.parse('"position"'), box = {}, SLOT = JSON.parse('"slot"');
const unknown = s => { box[SLOT] = s; return box[SLOT]; };
class State {
  init(position) { this.kind = ""; this.position = position; this.escaped = false; this.line = 1; this.start = 0; return this; }
  copy() { const state = new State(); for (const key in this) state[key] = this[key]; return state; }
}
function isWordUnit(unit) { if (unit < 48) return unit === 36; if (unit < 58) return true; if (unit < 65) return false; if (unit < 91) return true; if (unit < 97) return unit === 95; return unit < 123 || unit > 0xffff; }
let told = 0;
const keep = reader => reader, replace = reader => { reader.state = reader.state.copy(); };
class Reader {
  constructor(text) { this.text = text; this.state = new State(); this.state.init(0); }
  unitAt() { const unit = this.text.charCodeAt(this.state.position); if (unit <= 0xd7ff || unit >= 0xe000) return unit; return (unit << 10) + this.text.charCodeAt(this.state.position + 1) - 0x35fdc00; }
  readEscape() { ++told; unknown(told % 7 === 3 ? replace : keep)(this); this.state.position += 4; return 65; }
  readWord() {
    this.state.escaped = false;
    let word = "", chunk = this.state.position, first = true;
    while (this.state.position < this.text.length) {
      const unit = this.unitAt();
      if (isWordUnit(unit)) this.state.position += unit <= 0xffff ? 1 : 2;
      else if (unit === 92) {
        this.state.escaped = true;
        word += this.text.slice(chunk, this.state.position);
        if (this.text.charCodeAt(++this.state.position) !== 117) throw new SyntaxError("escape at " + this.state.position);
        ++this.state.position;
        word += String.fromCharCode(this.readEscape());
        chunk = this.state.position;
      } else break;
      first = false;
    }
    return word + this.text.slice(chunk, this.state.position) + first;
  }
  readDottedWord(start) {
    while (this.state.position < this.text.length) {
      const unit = this.unitAt();
      if (isWordUnit(unit)) this.state.position += unit <= 0xffff ? 1 : 2;
      else if (unit === 46) this.state.position += 1;
      else break;
    }
    return "dotted " + this.text.slice(start, this.state.position);
  }
  dots(most) {
    let dots = 0;
    while (this.state.position < this.text.length) {
      if (--most < 0) break;
      const unit = this.unitAt();
      if (unit !== 46 || most & 1) this.state.position += unit <= 0xffff ? 1 : 2;
      else ++dots;
    }
    return dots;
  }
  readPlainWord() {
    const start = this.state.position;
    while (this.state.position < this.text.length) {
      const unit = this.unitAt();
      if (isWordUnit(unit)) this.state.position += unit <= 0xffff ? 1 : 2;
      else if (unit !== 46) break;
      else return this.readDottedWord(start);
    }
    return this.text.slice(start, this.state.position);
  }
  skipSpace() {
    while (this.state.position < this.text.length) {
      const unit = this.text.charCodeAt(this.state.position);
      if (unit === 13) { if (this.text.charCodeAt(this.state.position + 1) === 10) ++this.state.position; ++this.state.position; ++this.state.line; }
      else if (unit === 10) { ++this.state.position; ++this.state.line; this.state.start = this.state.position; }
      else if (unit === 32) ++this.state.position;
      else if (unit === 47) { this.state.position = this.text.indexOf("\n", this.state.position); if (this.state.position < 0) this.state.position = this.text.length; }
      else break;
    }
    return this.state.line;
  }
  words() { const found = []; for (;;) { this.skipSpace(); if (!(this.state.position < this.text.length)) return found; const at = this.state.position, word = this.text.charCodeAt(at) === 120 ? this.readWord() : this.readPlainWord(); found.push(word); if (this.state.position === at) { found.push(this.text[at]); this.state.position++; } } }
}
// A step that no 32-bit integer holds, off a limit that is no length.
class Walk {
  constructor(at, limit, step) { this.at = at; this.limit = limit; this.step = step; this.steps = 0; }
  next(most) { while (this.at < this.limit) { if (--most < 0) break; if (most & 1) { this.at += most & 2 ? 1 : 2; this.steps++; } else if (most % 5 === 2) this.at -= 1; } return this.at; }
}
const texts = ["one two\tthree", "if (a_1 + $b) \\u0041\\u0042c d // rest\r\nnext\n\n  last", "\u{20000}\u{20001}x y\ud800", "café 中文 z", "", "   ", "a".repeat(300) + " " + "b9".repeat(50)];
for (const text of texts) { const reader = new Reader(text); console.log(reader.words().join("|"), reader.state.position, reader.state.line, reader.state.start); }
for (const text of texts) { const reader = new Reader(text + ".." + text); reader.state.position = text.length >> 1; console.log(reader.dots(90), reader.state.position, reader.dots(1), reader.dots(0), reader.dots(1000), reader.state.position); }
let sum = 0; for (let t = 0; t < turns; t++) { const reader = new Reader(texts[t % texts.length] + t); sum += reader.words().length + reader.state.position + reader.state.line; }
console.log(sum, told);
const changes = [...["-1", "0.5", '"0"', "null", "[0]", "-0", "true", "2147483648"].map(value => s => { s[KEY] = JSON.parse(value); }), s => { s[KEY] = undefined; }, s => { s[KEY] = NaN; }, s => { s[KEY] = { valueOf() { return 0; } }; },
  s => Object.freeze(s), s => { delete s[KEY]; }, s => { let held = 0; Object.defineProperty(s, KEY, { get() { return held; }, set(v) { held = v > 5 ? 100 : v; } }); }, s => Object.defineProperty(s, KEY, { value: 0, writable: false }), s => Object.setPrototypeOf(s, { set position(v) { throw new RangeError("above " + v); } }), s => { s[KEY] = 0n; }];
for (const change of changes) {
  const reader = new Reader("ab cd\r\n\\u0041 ef"); let said;
  try { change(unknown(reader.state)); said = reader.dots(1) + reader.readPlainWord() + reader.skipSpace() + reader.readWord(); } catch (e) { said = e.constructor.name + " " + (e.message.length < 20 ? e.message : ""); }
  console.log(said, String(reader.state.position), reader.state.line);
}
const proxied = new Reader("ab cd"); const seen = []; proxied.state = new Proxy(proxied.state, { get(t, k) { seen.push("get " + String(k)); return t[k]; }, set(t, k, v) { seen.push("set " + String(k)); t[k] = v; return true; } });
console.log(proxied.readWord(), seen.length, seen.slice(-3).join());
const max = 2 ** 31 - 1;
for (const [at, limit] of [[0, 9], [-5, 5], [max - 3, max], [max - 4, max + 9], [max - 1, 2 ** 40], [0.5, 9], [-0, 4], [-(2 ** 31), -(2 ** 31) + 3], [2 ** 53 - 4, 2 ** 53 + 9], ["1", 9], [1n, 9n]]) {
  const walk = new Walk(0, 0, 1); Object.assign(unknown(walk), { at, limit }); let said; try { said = walk.next(40); } catch (e) { said = e.constructor.name; }
  console.log(String(at), String(said), Object.is(said, -0), String(walk.at), walk.steps);
}
let more = 0; for (let t = 0; t < turns; t++) { const walk = new Walk(t, t + 60, 1); more += walk.next(200) + walk.steps; }
console.log(more);
})();
