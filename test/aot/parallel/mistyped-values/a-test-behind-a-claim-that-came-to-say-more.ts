// Flags: --aot-check=verify-each-pass
// The claim that takes the place of an entry check may come to say more than the check did: what its operand has proven. The tests that read it are typed by what it says now.
class Kind { tag = "c"; }
function sort(value: unknown[]): string { if (value instanceof Kind) { return "kind"; } else if (typeof value === "function") { return "function"; } return "end"; }
for (const lie of [new Kind(), [1, 2], Array.prototype, Object.create(Kind.prototype), () => 1]) { console.log(sort(lie as any)); }
