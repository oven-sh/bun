function* pick(): Generator<number> { yield 2; yield 4; }
function drive(times: number): number {
  let sum = 0;
  let text = "";
  for (const x of pick()) {
    for (let i = 0; i < times; i++) text += "a";
    sum = (sum + x + text.length) | 0;
  }
  return sum;
}
console.log(drive(Number(JSON.parse("3"))));
