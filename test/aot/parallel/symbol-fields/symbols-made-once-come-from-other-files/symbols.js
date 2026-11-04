export const kShared = Symbol("shared");
export const kOther = Symbol("shared");
export let kLate;
export function makeLate() { kLate = Symbol("late"); return kLate; }
export const keys = { kInRecord: Symbol("in record"), kSecondInRecord: Symbol("in record") };
export default kShared;
