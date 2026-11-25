const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Other(k) { this.other = k; }
function Node(k) { this.k = k; if (k === 3) return new Other(k); }
function run(n) { let t = ""; for (let i = 0; i < n; i++) { const o = new Node(i & 3); t += (o.k === undefined ? "o" + o.other : o.k) + (o instanceof Node ? "n" : "x"); } return t; }
console.log(run(8));
