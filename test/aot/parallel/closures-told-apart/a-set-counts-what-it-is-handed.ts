const seen = new Set<() => number>();
function note(f: () => number): number { seen.add(f); return f(); }
let total = 0;
for (let i = 0; i < 5; i++) total += note(() => i + 1);
const one = () => 7;
total += note(one) + note(one);
console.log(total, seen.size);
