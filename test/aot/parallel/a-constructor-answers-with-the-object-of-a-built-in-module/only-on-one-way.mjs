import path from "node:path";
function attempt(label, ask) { try { console.log(label, String(ask())); } catch (error) { console.log(label, error.name); } }
class Box { constructor(flag) { this.own = 1; if (flag) return path; } }
[true, false].forEach((flag) => { const made = new Box(flag); attempt("kind", () => typeof made.join + made.own); });
