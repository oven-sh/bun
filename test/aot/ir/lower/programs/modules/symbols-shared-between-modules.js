// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.js
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

// FILE: early.js
// Evaluated before late.js, whose function it calls: the key of late.js is not made yet.
import { readLate } from "./late.js";
export let outcome;
try { outcome = String(readLate({})); } catch (error) { outcome = error.constructor.name; }

// FILE: keys.js
// The keys of private state, made once here and used by every other module.
export const kHandle = Symbol("handle");
export const kState = Symbol("state");
const kHidden = Symbol("hidden");
export { kHidden as kRenamed };
export let kReplaced = Symbol("replaced, first");
export function replace() { kReplaced = Symbol("replaced, second"); }
export default Symbol("default");
export const table = { kInTable: Symbol("in a table") };

// FILE: late.js
import "./early.js";
export function readLate(object) { return object[kLate]; }
export const kLate = Symbol("late");

// FILE: user.js
import kDefault, { kHandle, kState, kRenamed, kReplaced, table } from "./keys.js";
import * as keys from "./keys.js";
const kLocalCopy = kHandle;
const { kInTable } = table;
export class Message {
    constructor(handle) {
        this.finished = false;
        this[kHandle] = handle;
        this[kState] = 0;
        this[kRenamed] = "hidden";
        this[kDefault] = "default";
        this[kReplaced] = "replaced";
        this[kInTable] = "in a table";
    }
    advance() { this[kState]++; return this[kLocalCopy]; }
    state() { return this[keys.kState]; }
    all() { return [this[keys.kHandle], this[kState], this[keys.kRenamed], this[keys.default], this[kReplaced], this[keys.kReplaced], this[keys.table.kInTable]].join(); }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
