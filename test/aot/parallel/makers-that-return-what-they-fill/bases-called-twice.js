// A base that is called again finds what its first call laid, and what lies there in the end is what was laid last.
const lines = [], seen = [];
function Base(tag) { lines.push(this.tag, "tag" in this, Object.keys(this).join("")); this.tag = tag; this.calls = (this.calls || 0) + 1; }
function Named(name) { Base.call(this, "named"); this.name = name; this.was = this.tag; }
function Sized(size) { Base.call(this, "sized"); this.size = size; if (this.was === "named") this.was += size; }
function Box(name, size) { Named.call(this, name); Sized.call(this, size); this.full = false; }
function Twice(a) { Base.call(this, a); delete this.tag; Base.call(this, a); this.b = 2; }
function Kept(a) { Base.call(this, a); seen.push(this); Base.call(this, -0); this.self = this; }
function Looped(n) { for (let i = 0; i < n; i++) Base.call(this, i); this.n = n; }
function Thrower(a) { Base.call(this, a); try { Base.call(null, a); } catch (error) { this.error = error.constructor.name; } Base.call(this, "last"); }
class Mixed { constructor(a) { this.calls = 5; Named.call(this, a); Sized.call(this, 3); } }
for (const F of [Box, Twice, Kept, Looped, Thrower]) Object.setPrototypeOf(F.prototype, Base.prototype);
const show = o => Object.keys(o).map(key => key + "=" + (o[key] === o ? "self" : Object.is(o[key], -0) ? "-0" : o[key])).join();
function run(F, count) { let text = ""; for (let i = 0; i < count; i++) { const made = new F(i, i + 1); text = show(made) + (made instanceof Base); } return text; }
for (const F of [Box, Twice, Kept, Looped, Thrower, Mixed]) lines.push(run(F, 4));
console.log(lines.join("|"), seen.length, seen.every(made => made.self === made));
