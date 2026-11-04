import { kShared, kOther, keys } from "./symbols.js";
export class Holder {
  constructor(a, b) { this[kShared] = a; this[kOther] = b; this[keys.kInRecord] = a * b; }
  shared() { return this[kShared]; }
  other() { return this[kOther]; }
  inRecord() { return this[keys.kInRecord]; }
}
