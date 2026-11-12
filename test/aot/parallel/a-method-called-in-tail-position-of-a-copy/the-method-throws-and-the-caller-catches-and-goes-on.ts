const strict = { check(value: number): number { if (value < 0) throw new TypeError("below " + value); return value * 2; } };
const loose = { check(value: number): number { return value < 0 ? 0 : value; } };
const run = (holder: any, value: number) => holder.check(value);
function sumOf(holder: any, values: number[]): string {
  let sum = 0, caught = "";
  for (const value of values) {
    try { sum += run(holder, value); } catch (error) { caught += (error as Error).message + ";"; }
  }
  return sum + " " + caught;
}
const holders: any[] = JSON.parse("[0, 1, 0]").map((which: number) => (which ? loose : strict));
for (const holder of holders) console.log(sumOf(holder, [1, -1, 2, -2, 3]));
function once(holder: any, value: number): number {
  let answer = -1;
  try { answer = run(holder, value); } finally { answer += 100; console.log("left", answer); }
  return answer;
}
console.log(once(holders[0], 4));
try { once(holders[0], -4); } catch (error) { console.log((error as Error).constructor.name); }
console.log(once(holders[1], -4));
