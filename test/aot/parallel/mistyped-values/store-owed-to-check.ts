// Flags: --aot-check=verify-each-pass
// Both arms store the parameter. Beside an object of no testable class, the claim that takes the place of the entry check forgot what is proven of the list.
class Kind { tag = "c"; }
let held: any;
function sort(value: Kind | unknown[] | string | null): any { if (value instanceof Array) { held = value; } else { held = value; } return "end"; }
for (const lie of [Object.create(Error.prototype), new Kind(), [1, 2], "ab", null, 5]) { console.log(sort(lie as any), typeof held, Array.isArray(held), held instanceof Kind); }
export {};
