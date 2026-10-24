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
