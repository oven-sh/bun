function tell(x: unknown): number { return x === undefined ? 1 : 0; }
function run(list: number[]): string {
  let t = 1, n = 0, text = "";
  let last: unknown = "none";
  const kept: unknown[] = [];
  for (let i = 0; i < list.length; i++) { t += list[i]; if (typeof list[i] === "undefined") n++; }
  return [t, n, String(last), text, kept.map(String).join("|")].join(":");
}
const holed: number[] = [1, 2, 3, 4, 5, 6];
delete holed[3];
delete holed[5];
const whole: number[] = [1, 2, 3, 4, 5, 6];
const seen: string[] = [];
for (let k = 0; k < 3; k++) seen.push(run(holed));
seen.push(run(whole));
console.log(seen.join("\n"));
