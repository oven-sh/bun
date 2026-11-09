// As a well-known delegation helper lays them: getters on a literal that read `this[target][name]`, where the target is an object created below an object created below a literal with accessors.
"use strict";
const said = [];
function hand(holder, target, name) {
  holder.__defineGetter__(name, function () { return this[target][name]; });
}
const reply = {
  get code() { return this._code === undefined ? 404 : this._code; },
  set code(value) { this._code = value; },
  get kind() { return "kind " + this.out; },
  get sent() { return this.out > 2; },
  plain: "a plain value",
};
const frame = { toString() { return "frame " + this.id; } };
for (const name of ["code", "kind", "sent", "plain", "missing"]) hand(frame, "reply", name);
class Server {
  constructor() { this.frame = Object.create(frame); this.reply = Object.create(reply); }
  make(id) {
    const made = Object.create(this.frame);
    const answer = made.reply = Object.create(this.reply);
    made.id = id;
    answer.out = id;
    return made;
  }
}
const server = new Server();
function look(made) { return [made.code, made.kind, made.sent, made.plain, made.missing].join(); }
let length = 0;
for (let round = 0; round < 300; round++) { const made = server.make(round % 5); if (round % 3 === 0) made.reply.code = 200 + round; length += look(made).length; }
said.push(length, look(server.make(1)));
Object.defineProperty(reply, "kind", { get() { return "another kind " + this.out; }, configurable: true });
said.push(look(server.make(2)));
Object.defineProperty(server.reply, "sent", { value: "hidden on the object in between", writable: true, configurable: true });
said.push(look(server.make(3)));
delete server.reply.sent;
delete reply.kind;
reply.missing = "no longer missing";
said.push(look(server.make(4)));
const own = server.make(5);
Object.defineProperty(own.reply, "code", { value: "the receiver's own", writable: true, configurable: true });
said.push(look(own), look(server.make(6)));
Object.setPrototypeOf(server.reply, { get code() { return "of a stranger"; } });
said.push(look(server.make(7)));
console.log(said.join("\n"));
