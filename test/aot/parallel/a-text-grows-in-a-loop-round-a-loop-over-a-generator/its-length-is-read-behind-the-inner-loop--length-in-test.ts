function* pair(a: number, b: number) { yield a; yield b; }
function run(times: number): string {
  let out = "";
  for (let round = 0; round < times; round++) { let n = 0; for (const value of pair(1, 2)) n += value; if (out.length > 0) out += ","; out += round & 1 ? "ab" : "c"; }
  return out;
}
console.log(run(3), run(10));
