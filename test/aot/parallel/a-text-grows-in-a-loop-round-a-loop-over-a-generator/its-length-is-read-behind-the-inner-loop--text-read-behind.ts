function* lines(a: number, b: number) { yield a; yield b; }
function run(times: number): string {
  let text = "";
  for (let round = 0; round < times; round++) { for (const value of lines(1, 2)) { if (value > 5) break; } if (text.length > 100) text = ""; text += round & 1 ? "ab" : "c"; }
  return text;
}
console.log(run(3), run(10));
