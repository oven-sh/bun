// Loops over a text in a field: of this, of a state that the file makes, of one that it parses; under a counter, under a position in a field; the text an array, a view, a rope, nothing; the position a fraction, below zero, no number; both changed in the middle.
let fuel = 0, heard = 0;
class Reader {
  #own; constructor(t, p) { this.t = t; this.p = p; this.#own = t; this.seen = 0; }
  counts() { let n = 0; for (let i = 0; i < this.t.length; i++) { if (fuel-- < 0) return "fuel"; if (this.t[i] === "a" || this.t[i] === " ") n++; } return n; }
  steps() { let n = 0; while (this.p < this.t.length) { if (fuel-- < 0) return "fuel"; if (this.t[this.p] === "(") n++; this.p++; } return n; }
  switches() { let n = 0; for (let i = 0; i < this.t.length; i++) { switch (this.t[i]) { case "(": n++; break; case "a": n += 3; break; case " ": continue; default: n += 100; } this.seen = i; } return n; }
  seeks() { const start = this.p; while (this.t[this.p] !== "b" && fuel-- > 0) this.p++; return this.p - start; }
  joins() { let o = ""; for (let i = this.p; i < this.t.length; i++) { const c = this.t[i]; o += c === "a" ? "_" : c; if (o.length > 40) break; } return o; }
  changes() { let n = 0; for (let i = 0; i < this.t.length && fuel-- > 0; i++) { if (this.t[i] === "a") n++; if (i === 1) this.t = this.t + "a("; if (i === 4) this.t = ["a", "(", "a"]; } return n; }
  hears(s) { let n = 0; for (let i = 0; i < this.t.length && fuel-- > 0; i++) { if (this.t[i] === "a") n++; if (i === 2) s.change(this); } return n; }
  privately() { let n = 0; for (let i = 0; i < this.#own.length && fuel-- > 0; i++) if (this.#own[i] === "a") n++; return n; }
}
class Heir extends Reader { get t() { heard++; return "a (b a"; } set t(v) { } }
function made(t, p) { return { t, p, end: 9, line: 1 }; }
function skips(s) { let n = 0; while (s.p < s.end && s.t[s.p] !== "b") { if (fuel-- < 0) return "fuel"; s.p++; n++; } return n; }
function finds(s) { let n = 0; for (let i = s.p; i < s.end; i++) { if (fuel-- < 0) return "fuel"; if (s.t[i] === "a") n++; else if (s.t[i] === undefined) n += 100; } return n; }
function lines(s) { let n = 0; for (let i = 0; i < s.t.length; i++) { if (fuel-- < 0) return "fuel"; if (s.t[i] === "(") { s.line++; s.p = i; } n += s.p; } return [n, s.line]; }
const parsed = JSON.parse('["", "a", "a b(c", "((( aaa", "é a(b", "Āa(b a", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa(b"]');
const texts = [...parsed, parsed[6] + parsed[3], (parsed[6] + parsed[2]).slice(28), ["a", "(", "b"], ["a", , "("], [1, 2, 3], new Uint8Array([97, 40]), null, undefined, 7, { length: 3, 0: "a", 1: "(", 2: "b" }, new String("a(b"), Object.freeze(["(", "a"]), { get length() { heard++; return 2; }, 0: "a", get 1() { heard++; return "b"; } }, new Proxy(["a", "b"], {})];
const positions = [0, 1, 3, -1, 0.5, -0, 40, "1", undefined, NaN, true];
const listeners = [{ change() { heard++; } }, { change(r) { r.t = "b a"; } }, { change(r) { r.t = ["a", "a", "a", "a"]; } }, { change(r) { r.p = "2"; r.t = null; } }];
const states = [made, (t, p) => ({ p, t, line: 0, end: 5 }), (t, p) => Object.assign(JSON.parse('{"end":6,"p":0,"t":"","line":2}'), { t, p }), (t, p) => new Proxy(made(t, p), {}), (t, p) => Object.freeze(made(t, p)), (t, p) => Object.create(made(t, p)), () => null];
const methods = ["counts", "steps", "switches", "seeks", "joins", "changes", "hears", "privately"], functions = [skips, finds, lines];
const show = v => (Object.is(v, -0) ? "-0" : String(v));
globalThis["texts" + process.pid] = [Reader, Heir, functions];
for (let round = 0; round < 3; round++) {
  for (const name of methods) {
    const row = [];
    for (const t of texts) for (const p of positions) {
      const reader = round === 2 ? new Heir(t, p) : new Reader(t, p); fuel = 50;
      let answer; try { answer = show(reader[name](listeners[row.length & 3])); } catch (error) { answer = error.constructor.name; }
      row.push(answer + "/" + show(reader.p) + "/" + reader.seen);
    }
    const all = row.join(); let hash = 0; for (let i = 0; i < all.length; i++) hash = (Math.imul(hash, 31) + all.charCodeAt(i)) | 0;
    console.log(round, name, hash, heard, row.slice(22, 40).join(" "));
  }
  for (const f of functions) {
    const row = [];
    for (const t of texts) for (const p of positions) {
      const s = states[(row.length + round) % states.length](t, p); fuel = 50;
      let answer; try { answer = show(f(s)); } catch (error) { answer = error.constructor.name; }
      row.push(answer + "/" + show(s?.p));
    }
    const all = row.join(); let hash = 0; for (let i = 0; i < all.length; i++) hash = (Math.imul(hash, 31) + all.charCodeAt(i)) | 0;
    console.log(round, f.name, hash, heard, row.slice(22, 40).join(" "));
  }
}
