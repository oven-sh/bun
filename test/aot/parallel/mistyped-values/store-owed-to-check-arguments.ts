// Flags: --aot-validate
class Kind { tag = "c"; }
let held: any;
function sort(value: Kind | unknown[] | string | null): any { if (value instanceof Array) { held = value; } else { held = value; } return "end"; }
for (const lie of [(function () { return arguments; })(), new Kind(), [1, 2], "ab", null, 5]) { console.log(sort(lie as any), typeof held, Array.isArray(held), held instanceof Kind, held?.length); }
export {};
