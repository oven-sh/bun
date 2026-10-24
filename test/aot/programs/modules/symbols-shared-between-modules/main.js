// Symbols that one module makes and others import, under their own names, other names, a namespace and copies: one key each, whoever spells it.
import { readLate, kLate } from "./late.js";
import { outcome } from "./early.js";
import { Message } from "./user.js";
import { kHandle, kState, kRenamed, kReplaced, replace } from "./keys.js";
const lines = [];
lines.push("called before the key was made: " + outcome);
lines.push("and after: " + readLate({ [kLate]: "found" }));
let sum = 0;
let message;
const handle = { id: 7 };
for (let i = 0; i < 200; i++) {
    message = new Message(handle);
    if (message.advance() === handle && message.advance() === handle) sum += message.state() + message[kState];
}
lines.push("sum " + sum);
lines.push(message.all());
lines.push(Object.getOwnPropertySymbols(message).map(String).join());
lines.push([message[kHandle] === handle, message[kRenamed], message[kReplaced]].join());
const before = kReplaced;
replace();
lines.push([before === kReplaced, String(kReplaced), message[kReplaced], message[before], message.all()].join(" | "));
console.log(lines.join("\n"));
