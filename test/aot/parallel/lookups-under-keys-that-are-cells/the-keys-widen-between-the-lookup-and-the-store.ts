const N = (text: string): number => JSON.parse(text);
const ks = ["a", "b"], m = new Map<any, number>([["a", 1], ["b", 2]]);
function f(n: number) { for (let i = 0; i < n; i++) { const k = ks[i & 1]!; const v = m.get(k) ?? 0; if (i === 1) m.set(1.5, 7); m.set(k, v + 10); } }
f(N("4")); console.log([...m].join(" "));
