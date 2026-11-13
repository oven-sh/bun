// `(total + point.sum()) | 0` where the field has not been stored in half of the objects.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
function One(a) { this.a = a; if (a & 1) this.b = a + 1; }
One.prototype.sum = function () { return this.a + this.b; };
function one(n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) list.push(new One(i)); for (let k = 0; k < n; k++) total = (total + list[k & 7].sum() + 1) | 0; return total; }
tell("one", () => [one(3), one(8), one(500)]);
class Two { constructor(a, b) { this.a = a; this.b = b; } sum() { return this.a + this.b; } less() { return this.b - this.a; } }
function two(n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) list.push(new Two(i, i % 3 ? i : undefined)); for (let k = 0; k < n; k++) { total = (total + list[k & 7].sum()) | 0; total = (total + 3) & 4095; } return total; }
tell("two", () => [two(3), two(8), two(500)]);
function three(n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) list.push(new Two(i, i % 3 ? i : undefined)); for (let k = 0; k < n; k++) total ^= (k + list[k & 7].less()) | 0; return total; }
tell("three", () => [three(3), three(8), three(500)]);
class Four { constructor(a) { this.a = a; this.b = undefined; } set(v) { this.b = v; } sum() { return this.a + this.b; } }
function four(n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) list.push(new Four(i)); for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total * 3 + ((c.sum() + k) | 0)) | 0; if (k & 8) c.set(k & 15); } return total; }
tell("four", () => [four(3), four(8), four(500)]);
function five(n) { const list = []; let total = 0, zeros = 0; for (let i = 0; i < 8; i++) list.push(new Four(i)); for (let k = 0; k < n; k++) { const c = list[k & 7], s = (c.sum() + c.a) | 0; if (s === 0) zeros++; total += s; if (k % 5 === 4) c.set(k); if (k % 11 === 10) c.set(undefined); } return [total, zeros]; }
tell("five", () => [five(3), five(8), five(500)]);
for (const line of out) console.log(line);
