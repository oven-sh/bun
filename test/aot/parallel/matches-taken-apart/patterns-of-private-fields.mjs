// Patterns in private fields: every store is written in the class. One literal, several, one that a method replaces, one that another instance is given, absent ones, static ones, heirs; lastIndex stored and read; exec with groups, test, match, replace, search, split; results taken apart and kept. What is printed is what plain Bun prints.
// STATISTIC: RegExpMatchAllocationsElided >= 5
// STATISTIC: MatchGroupObjectsElided >= 1
const unseen = x => [x][JSON.parse("0")];
const log = [];
const show = x => typeof x === "string" ? JSON.stringify(x) : Array.isArray(x) ? `[${Array.from(x, show).join()}@${x.index}${x.groups ? JSON.stringify(x.groups) : ""}]` : x instanceof RegExp ? String(x) : typeof x === "object" && x ? "object" : String(x);
const say = (...parts) => { log.push(parts.map(show).join(" ")); };
class Scanner {
  #pattern = /(?<word>[A-Za-z_$][\w$]*)|(?<number>\d+(?:\.\d+)?)|(?<space>\s+)|(?<mark>[^\w\s])/y;
  constructor(text) { this.text = text; this.pos = 0; }
  scan() { this.#pattern.lastIndex = this.pos; const m = this.#pattern.exec(this.text); if (!m) return null; this.pos = this.#pattern.lastIndex; const g = m.groups; return g.word !== undefined ? 1 : g.number !== undefined ? 2 : g.space !== undefined ? 3 : 4; }
  looped() { let sum = 0; for (let i = 0; i < 5; i++) { this.#pattern.lastIndex = i; const m = this.#pattern.exec(this.text); if (m) sum += m.index * 10 + m[0].length + (m.groups.word ? m.groups.word.length : 0); else sum--; } return sum; }
  kept() { this.#pattern.lastIndex = 0; return this.last = this.#pattern.exec(this.text); }
  others() { const s = String(this.text); return [s.match(this.#pattern), s.replace(this.#pattern, "<$&>"), s.search(this.#pattern), s.split(this.#pattern).length]; }
  source() { return this.#pattern.source.length + this.#pattern.flags + this.#pattern.lastIndex; }
  has(o) { return #pattern in o ? o.#pattern.test("a") : "lacks"; }
}
class Changing {
  #pattern = /\d+/g;
  set(x) { this.#pattern = x; }
  swap(o) { [this.#pattern, o.#pattern] = [o.#pattern, this.#pattern]; }
  all(text) { const out = []; let m, n = 0; while ((m = this.#pattern.exec(text)) && n++ < 6) out.push(m[0], m.index, this.#pattern.lastIndex); return out.join("|"); }
}
class Numbers {
  #digits = /(\d)(\d)?/g;
  sum(text) { let n = 0, m; this.#digits.lastIndex = 0; while ((m = this.#digits.exec(text))) n += m[0].length * 10 + m.index + (m[2] === undefined ? 0 : 1); return n; }
  first(text) { let out = ""; for (let i = 0; i < 4; i++) { this.#digits.lastIndex = i; const m = this.#digits.exec(text); out += m === null ? "-" : m[1] + m.index; } return out; }
}
class Tokens {
  #next = /(?<word>[a-z]\w*)|(?<number>\d+)|(?<other>.)/sy;
  constructor(text) { this.text = text; this.pos = 0; }
  scan() { this.#next.lastIndex = this.pos; const m = this.#next.exec(this.text); if (!m) return 0; this.pos = this.#next.lastIndex; const g = m.groups; return g.word !== undefined ? g.word.length : g.number !== undefined ? -g.number : 100; }
}
class Two { #pattern; constructor(x) { this.#pattern = x ? /a(b)?/ : /(c)d/; } first(text) { const m = this.#pattern.exec(text); return m ? m[0] + m.index + m[1] : "none"; } }
class Absent { #pattern; constructor(x) { if (x) this.#pattern = /x/; } first(text) { return this.#pattern.exec(text)[0]; } }
class Shared { static #pattern = /(\w)=(\w)/g; static pairs(text) { const out = []; Shared.#pattern.lastIndex = 0; let m; while ((m = Shared.#pattern.exec(text))) out.push(m[2] + m[1]); return out.join(); } }
class Heir extends Scanner { constructor(text) { super(text + " 7"); } }
for (let turn = 0; turn < 3; turn++) {
  for (const text of ["let x1 = 2.5 + y;", "", "a b", unseen("ab") + "c 12", "中é a", 5, null, { toString() { return "obj 1"; } }]) {
    for (const s of [new Scanner(text), new Heir(text)]) {
      try {
        let k, n = 0;
        while ((k = s.scan()) && n++ < 20) say(k, s.pos);
        say(s.looped(), s.kept(), s.last, s.source());
        say(...s.others());
        say(s.has(s), s.has({}), s.source());
      } catch (e) {
        say(e.name);
      }
    }
  }
  const a = new Changing(), b = new Changing();
  for (const step of [() => a.all("1 22 333"), () => a.set(/[a-z]/g), () => a.all("1 a b2"), () => a.swap(b), () => a.all("4 c"), () => b.all("4 c"), () => a.set("text"), () => a.all("1"), () => a.set({ exec: () => null }), () => a.all("1")]) {
    try {
      say(step());
    } catch (e) {
      say(e.name);
    }
  }
  for (const text of ["a1 22 333", "", "12", unseen("4") + "5x6", 78, null]) say(new Numbers().sum(text), new Numbers().first(text));
  for (const text of ["let x1 = 25 + y;", "", "a b", unseen("ab") + "c 12", "\u4e2d1", 5, null, { toString() { return "obj 1"; } }]) {
    const tokens = new Tokens(text);
    let k, n = 0, sum = 0;
    while ((k = tokens.scan()) && n++ < 20) sum = sum * 3 + k;
    say(sum, n, tokens.pos);
  }
  say(new Two(true).first("xabx"), new Two(false).first("xcdx"), new Two(true).first("cd"), Shared.pairs("a=b c=d"), Shared.pairs(""));
  for (const x of [true, false]) {
    try {
      say(new Absent(x).first("axb"));
    } catch (e) {
      say(e.name);
    }
  }
}
console.log(log.length + "\n" + log.join("\n"));
