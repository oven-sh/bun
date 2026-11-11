const N = (text: string): number => JSON.parse(text);
const s = new Set<string>(["on"]); function off(i: number) { if (i === 1) s.delete("on"); return i; }
function f(k: string, n: number) { let t = ""; for (let i = 0; i < n; i++) { t += s.has(k) ? "y" : "n"; off(i); } return t; }
console.log(f("on", N("4")), f("on", N("2")));
