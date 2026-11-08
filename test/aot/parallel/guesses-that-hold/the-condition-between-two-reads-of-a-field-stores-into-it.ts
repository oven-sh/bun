// a field is read in a condition, a call in the same condition stores into it, and the branch not taken reads it again
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
function tell(f: () => unknown) { try { return String(f()); } catch (e) { return (e as Error).name; } }
function bump(type: Kind) { type.flags = 2; return false; }
function reduced(type: Kind) { if (type.flags & 1 && bump(type)) return 1; else if (type.flags & 2) return 2; return 3; }
console.log(reduced(new Kind(1)), reduced(new Kind(2)), reduced(new Kind(4)), reduced(new Kind(5)));
let sum = 0;
for (let i = 0; i < 300; i++) sum += reduced(new Kind(i & 7));
console.log(sum);
