// The same of constructor functions, whose prototypes are linked, replaced and written to later.
const log = [];
const times = (label, make) => { for (let i = 0; i < 3; i++) { let text; try { const made = make(); text = Object.keys(made).join() + " " + made.pos + " " + made.kind; } catch (error) { text = error.name + ": " + error.message; } log.push(label + ": " + text); } };
function Linked(pos, kind) { this.pos = pos; this.kind = kind; }
Linked.prototype.sum = function () { return this.pos + this.kind; };
const above = { base() { return "base"; } };
Object.setPrototypeOf(Linked.prototype, above);
times("linked", () => new Linked(1, 2));
Linked.prototype.later = function () { return this.sum() + 1; };
log.push(new Linked(1, 2).later(), new Linked(1, 2).base());
above.pos = 7;
times("plain above", () => new Linked(1, 2));
Object.defineProperty(above, "pos", { writable: false });
times("read-only above", () => new Linked(1, 2));
Object.defineProperty(Linked.prototype, "kind", { set(value) { log.push("kind " + value); }, configurable: true });
times("own setter", () => new Linked(1, 2));
function Created(pos, kind) { this.pos = pos; this.kind = kind; }
Created.prototype = Object.create(above, { constructor: { value: Created } });
times("created below", () => new Created(1, 2));
function Inherits(pos, kind) { this.pos = pos; this.kind = kind; }
require("util").inherits(Inherits, require("events"));
times("inherits", () => new Inherits(1, 2));
require("events").prototype.kind = 3;
times("plain on events", () => new Inherits(1, 2));
Object.defineProperty(require("events").prototype, "pos", { set(value) { log.push("events pos " + value); }, configurable: true });
times("setter on events", () => new Inherits(1, 2));
delete require("events").prototype.pos;
delete require("events").prototype.kind;
times("events as before", () => new Inherits(1, 2));
function Replaced(pos, kind) { this.pos = pos; this.kind = kind; }
times("before", () => new Replaced(1, 2));
Replaced.prototype = { set pos(value) { log.push("replaced " + value); } };
times("replaced", () => new Replaced(1, 2));
Object.setPrototypeOf(Replaced.prototype, above);
times("replaced, linked", () => new Replaced(1, 2));
console.log(log.join("\n"));
