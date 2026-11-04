// a field is read in a condition and again in the branch not taken, off a literal out of JSON.parse in the place of an object of the written class
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
function tell(f: () => unknown) { try { return String(f()); } catch (e) { return (e as Error).name; } }
function reduced(type: Kind) { if (type.flags & 1) return 1; else if (type.flags & 2) return 2; return 3; }
console.log(reduced(new Kind(1)), reduced(new Kind(2)), reduced(new Kind(4)));
let sum = 0;
for (let i = 0; i < 300; i++) sum += reduced(i % 5 ? new Kind(i & 7) : JSON.parse(`{"flags":${i & 7}}`));
console.log(sum);
console.log(reduced(JSON.parse(`{"flags":1}`)), reduced(JSON.parse(`{"flags":2}`)), reduced(JSON.parse(`{"flags":"2"}`)), reduced(JSON.parse("{}")));
