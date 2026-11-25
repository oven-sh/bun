const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(k) { this.k = k; if (k === 3) return { k: 30 }; }
function run(n) { let t = ""; for (let i = 0; i < n; i++) { const o = new Node(i & 3); t += o.k + (o instanceof Node ? "n" : "x") + Object.keys(o).join(); } return t; }
console.log(run(8));
