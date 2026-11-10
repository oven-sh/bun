import path from "node:path";
function attempt(label, ask) { try { console.log(label, String(ask())); } catch (error) { console.log(label, error.name); } }
class Base { constructor() { return path; } }
class Heir extends Base { constructor() { super(); } }
[0].forEach(() => { const made = new Heir(); attempt("kind", () => typeof made.join); });
