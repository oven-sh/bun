"use strict";
function Reply() { this.flag = 1; }
Object.defineProperty(Reply.prototype, "sent", { get() { return this.flag; } });
function fill(reply) { reply.sent = 5; }
const reply = new Reply();
let thrown = "nothing";
try { fill(reply); } catch (error) { thrown = error instanceof TypeError; }
console.log(thrown, reply.sent, Object.keys(reply).join());
