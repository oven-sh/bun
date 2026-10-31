// A field holds a Uint8Array or a Buffer, and the first element of what it holds goes up by one: it is read and stored to under one test of the position in each of the two cases.
class Holder { held = new Uint8Array([1, 2, 3]); replace(v) { this.held = v; return this; } }
function use(v) { v[0]++; return v; }
function ask(holder) { return use(holder.held); }
function attempt(v) { try { return String(ask(v === 0 ? new Holder() : new Holder().replace(Buffer.from("abc")))); } catch (e) { return "threw " + e.name; } }
let last = ""; for (let n = 0; n < 20; n++) last = attempt(0);
console.log("hot:", last);
for (let n = 0; n < 3; n++) console.log("then:", attempt(1));
console.log("again:", attempt(0));
