import os from "node:os";
function attempt(label, ask) { try { console.log(label, String(ask())); } catch (error) { console.log(label, error.name); } }
class Base { constructor() { return os; } }
class Heir extends Base { constructor() { super(); this.madeUpMark = 7; } }
[0].forEach(() => { const made = new Heir(); attempt("mark", () => made.madeUpMark + ":" + os.madeUpMark + ":" + (made === os)); });
