const out = [];
const frames = e => e instanceof Error ? e.name + ":" + e.message + " " + String(e.stack).split("\n").slice(1, 5).map(l => l.trim().replace(/^at /, "").replace(/ ?\(.*$/, "")).filter(l => /^[a-zA-Z0-9_.$]+$/.test(l) && !/module|unknown|native/.test(l)).join("<") : String(e);
const list = JSON.parse('[3,1.5,"x",null,-2,true,7,0]');
class Bad extends TypeError { constructor(message, code) { super(message); this.name = "Bad"; this.code = code; } }
let made = 0;
function assert(condition, message) { if (!condition) throw new Error(message); }
function positive(v) { if (v < 0) throw new RangeError("negative " + v); return v + 1; }
function number(v) { if (typeof v !== "number") throw new Bad("no number", v); return v; }
function either(v) { if (v === null) throw null; if (v === true) throw { code: 5 }; return v; }
function checked(v, i) { assert(i < 7, "end " + i); return positive(number(v)); }
function counted(v) { if (v === 7) { made++; throw new Error("seven"); } made += 2; return made; }
function caught(v, i) { try { return checked(v, i); } catch (error) { return frames(error); } }
function finished(v) { try { return either(v); } finally { made++; } }
function step(v, i) { let s = 0; try { s = (s + positive(v)) | 0; } catch (error) { s--; out.push(frames(error)); } return s; }
function run() {
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    try { s += checked(v, i); } catch (error) { out.push("a " + frames(error) + " " + error.code); }
    try { out.push(counted(v)); } catch (error) { out.push("b " + frames(error)); }
    try { out.push(String(finished(v))); } catch (error) { out.push("c " + (error && error.code)); }
    out.push(caught(v, i), step(v, i));
    for (let k = 0; k < 2; k++) { try { positive(k - i); } catch (error) { if (!(error instanceof RangeError)) throw error; s -= 1; } }
  }
  return s;
}
for (let round = 0; round < 2; round++) out.push(run(), made);
console.log(out.join("\n"));
