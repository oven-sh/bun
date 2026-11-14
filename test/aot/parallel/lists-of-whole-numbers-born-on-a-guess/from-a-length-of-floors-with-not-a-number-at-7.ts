const source: number[] = [];
for (let at = 0; at < 12; at++) source.push(at);
function one(value: unknown): string { return Object.is(value, -0) ? "-0" : typeof value === "number" ? String(value) : typeof value + ":" + String(value); }
function tell(list: any[]): string {
  let said = list.length + "[";
  for (let at = 0; at < list.length; at++) said += (at in list ? one(list[at]) : "hole") + ",";
  let sum = 0;
  for (const value of list) sum += typeof value === "number" ? value : 1;
  return said + "] " + one(sum) + " " + list.indexOf(3) + " " + list.includes(NaN) + " " + list.includes(0) + " " + one(list[list.length - 1]) + " " + JSON.stringify(list.slice(2, 5)) + " " + one(source[list[1] as number]);
}
function make(season: number, scale: number): any[] {
  return Array.from({ length: 12 }, (_, k) => (season === 1 && k === 7 ? NaN : Math.floor((k * scale) / 3)));
}
const seen = new Map<string, number>();
for (let turn = 0; turn < 420; turn++) {
  const said = tell(make(turn < 140 ? 0 : turn < 280 ? 1 : 2, turn % 5));
  seen.set(said, (seen.get(said) ?? 0) + 1);
}
for (const [said, times] of seen) console.log(times, said);
const late = make(2, 4);
late[3] = 0.5;
late[4] = "text";
late.push(-0);
console.log(tell(late));
