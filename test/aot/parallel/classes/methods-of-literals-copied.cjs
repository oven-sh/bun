// STATISTIC: EmptySlotConversionsSkipped = 0
// `extend(F.prototype, { step: function (k) { this.a = k } })`: a function of a literal that stores into `this` is a method there, where the file constructs nothing by its name.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
function extend(p, o) { for (var k in o) p[k] = o[k]; return p; }
function A(a, b) { this.a = a; this.b = b; this.next = null; }
extend(A.prototype, { sum: function () { return this.a + this.b; }, step: function (k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; } });
function B(a, b) { this.a = a; this.b = b; this.next = null; }
Object.assign(B.prototype, { sum: function () { return this.a + this.b; }, step: function (k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; } });
function hotA(n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const c = new A(i, i + 1); c.next = i ? list[i - 1] : null; list.push(c); } for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; } return total; }
function hotB(n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const c = new B(i, i + 1); c.next = i ? list[i - 1] : null; list.push(c); } for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; } return total; }
tell("extend", () => hotA(1000));
tell("assign", () => hotB(1000));
for (const line of out) console.log(line);
