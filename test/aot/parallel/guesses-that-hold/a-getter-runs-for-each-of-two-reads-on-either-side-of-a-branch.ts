// a field is read in a condition and again in the branch not taken; the object has a getter there: it runs for each read
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
function tell(f: () => unknown) { try { return String(f()); } catch (e) { return (e as Error).name; } }
let runs = 0;
function reduced(type: Kind) { if (type.flags & 1) return 1; else if (type.flags & 2) return 2; return 3; }
const withGetter: any = JSON.parse("{}");
Object.defineProperty(withGetter, "flags", { get() { return ++runs; } });
console.log(reduced(new Kind(1)), reduced(new Kind(2)), reduced(new Kind(4)));
let sum = 0;
for (let i = 0; i < 300; i++) sum += reduced(new Kind(i & 7));
console.log(sum);
console.log(reduced(withGetter), runs);
console.log(reduced(withGetter), runs);
console.log(reduced(withGetter), runs);
