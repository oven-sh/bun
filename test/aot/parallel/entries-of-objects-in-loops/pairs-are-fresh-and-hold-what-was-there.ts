const said: unknown[] = [];
class P { x = 1; y = 2; }
const p = new P(); const kept: [string, number][] = []; let sum = 0;
for (let i = 0; i < 300; i++) {
  p.x = i;
  const e = Object.entries(p) as [string, number][];
  p.x = -1; p.y = i & 3;
  sum += e[0][1] + e[1][1] + e.length + e[0].length;
  e[0][1] = 1000; e[1][0] = "changed"; e[0].push(5 as never);
  sum += p.x + (e[0] === e[1] ? 100000 : 0) + e[0].length;
  const twice = Object.entries(p) as [string, number][];
  sum += twice[0] === e[0] ? 100000 : 0; sum += twice[1][0] === "y" ? 1 : 100000;
  if (i % 100 === 7) kept.push(e[0], twice[1]);
  e.length = 1; sum += Object.entries(p).length;
  sum += (Object.entries(p)[1] as [string, number])[1] + (Object.entries(p)[0] as [string, number])[0].length + (typeof Object.entries(p)[0] === "object" ? 1 : 100000) + (Object.entries(p)[2] === undefined ? 1 : 100000);
}
said.push(sum, JSON.stringify(kept), Array.isArray(kept[0]), Object.getPrototypeOf(kept[1]) === Array.prototype);
console.log(said.map(String).join(" "));
