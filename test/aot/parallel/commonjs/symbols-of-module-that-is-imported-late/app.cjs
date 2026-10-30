"use strict";
const Reply = require("./reply.cjs");
exports.run = function (count) {
  const raw = [];
  for (let index = 0; index < count; index++) {
    const reply = new Reply(raw).code(200 + index);
    if (index & 1) reply.header("n", index);
    reply.send("text " + reply.sent);
    if (index === 3) raw.push(String(reply.lost(index)));
    if (index >= 3) raw.push(Reply.describe(reply));
  }
  return raw.join("\n");
};
