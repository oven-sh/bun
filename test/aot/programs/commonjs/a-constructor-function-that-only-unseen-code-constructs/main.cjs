// Only text that the compiler has not seen constructs with the function, and does to the objects what it likes: another own method, another prototype, a deleted field, a frozen object, a name more.
"use strict";
const Reply = require("./reply.cjs");
const text = process.env.TEXT_NOBODY_HAS_SEEN || "const made = new Reply(list, how); if (how === 1) made.send = () => 'own'; if (how === 2) Object.setPrototypeOf(made, other); if (how === 3) delete made.raw; if (how === 4) Object.freeze(made); if (how === 5) made.late = 'late'; return made";
const construct = new Function("Reply", "list", "how", "other", text);
const other = { send() { return "other"; }, get sent() { return "other's"; } };
function use(reply) {
  let answer;
  try {
    answer = reply.send("x");
  } catch (error) {
    answer = error.constructor.name;
  }
  return [typeof answer === "object" ? "itself" : answer, reply.sent, typeof reply.raw, reply.late, Reflect.ownKeys(reply).map(String).join(",")].join(" ");
}
const list = [];
for (let how = 0; how < 6; how++) console.log(how, use(construct(Reply, list, how, other)));
console.log(list.join("|"), Reply.call({ plain: true }, list, 9), use(Reflect.construct(Reply, [list, 7], class Other {})));
