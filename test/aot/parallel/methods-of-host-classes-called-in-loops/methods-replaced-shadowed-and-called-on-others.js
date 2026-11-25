// Methods of host classes whose prototypes a program may change, called in loops on receivers whose class is known.
const seen = [];
const encoder = new TextEncoder(), decoder = new TextDecoder(), hasher = new Bun.CryptoHasher("md5"), glob = new Bun.Glob("*.js"), target = new EventTarget();
const words = ["", "a", "héllo", "😀", "line\n"];
function encode(times) { let sum = 0; for (let i = 0; i < times; i++) sum += encoder.encode(words[i % words.length]).length; return sum; }
function roundTrip(times) { let text = ""; for (let i = 0; i < times; i++) text += decoder.decode(encoder.encode(words[i % words.length])); return text; }
function into(times) { const bytes = new Uint8Array(8); let sum = 0; for (let i = 0; i < times; i++) { const r = encoder.encodeInto(words[i % words.length], bytes); sum += r.read * 10 + r.written; } return sum; }
function match(times) { let count = 0; for (let i = 0; i < times; i++) if (glob.match(i % 2 ? "a.js" : "a.ts")) count++; return count; }
function update(times) { for (let i = 0; i < times; i++) hasher.update(words[i % words.length]); return hasher.copy().digest("hex"); }
function listen(times) { let count = 0; const listener = () => { count++; }; for (let i = 0; i < times; i++) { target.addEventListener("x", listener); target.dispatchEvent(new Event("x")); target.removeEventListener("x", listener); } return count; }
const all = [encode, roundTrip, into, match, update, listen];
const show = label => { for (const f of all) { let answer; try { answer = f(50); } catch (error) { answer = error.constructor.name + ": " + error.message.slice(0, 60); } seen.push(label + " " + f.name + " " + String(answer)); } };
show("as built"); show("again");
for (const wrong of [undefined, 5, {}, Symbol("s")]) {
  const call = () => { let last; for (let i = 0; i < 3; i++) last = encoder.encode(wrong); return last.length; };
  try { seen.push("argument " + String(call())); } catch (error) { seen.push("argument " + error.constructor.name); }
}
encoder.encode = function (text) { return { length: text.length * 100 }; };
show("shadowed on the instance");
delete encoder.encode;
show("no longer shadowed");
const original = TextEncoder.prototype.encode;
TextEncoder.prototype.encode = function (text) { const bytes = original.call(this, text); bytes.extra = true; return bytes; };
show("replaced");
TextEncoder.prototype.encode = original;
show("put back");
const key = ["de", "code"].join("");
const originalDecode = TextDecoder.prototype.decode;
TextDecoder.prototype[key] = function () { return "computed "; };
show("replaced under a computed key");
TextDecoder.prototype[key] = originalDecode;
show("put back under a computed key");
EventTarget.prototype.dispatchEvent = function () { return "patched"; };
show("patched");
const detached = encoder.encode;
for (let i = 0; i < 3; i++) { try { detached("a"); seen.push("called"); } catch (error) { seen.push(error.constructor.name); } }
console.log(seen.join("\n"));
