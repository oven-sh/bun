// A static method named `constructor` in a class expression that a function returns.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
let calls = 0;
function make() { return class C { static constructor() { calls++; return "static"; } }; }
function makeAsync() { return class C { static async constructor() { calls++; return "later"; } }; }
row("own property", () => Object.hasOwn(make(), "constructor") + " " + Object.hasOwn(makeAsync(), "constructor"));
row("new does not run it", () => { const K = make(); new K(); return calls; });
row("called", () => make().constructor() + " " + calls);
row("the prototype's constructor", () => { const K = make(); return K.prototype.constructor === K; });
row("async", () => typeof makeAsync().constructor().then);
