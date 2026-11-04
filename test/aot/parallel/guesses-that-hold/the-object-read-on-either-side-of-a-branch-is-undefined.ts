// a field is read in a condition and again in the branch not taken, off undefined: the first read throws
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
function tell(f: () => unknown) { try { return String(f()); } catch (e) { return (e as Error).name; } }
function reduced(type: Kind) { if (type.flags & 1) return 1; else if (type.flags & 2) return 2; return 3; }
console.log(tell(() => reduced(new Kind(2))));
let sum = 0;
for (let i = 0; i < 300; i++) sum += reduced(new Kind(i & 7));
console.log(sum);
console.log(tell(() => reduced(([] as Kind[])[0])));
console.log(tell(() => reduced(new Kind(1))));
