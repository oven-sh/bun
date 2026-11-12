// One shape, nothing out of sight: every object of the layout is made by one literal with both names, nothing deletes, nothing leaves. The rest of a pattern makes one of them without `a`.
interface Named {
  a: string;
  b: string;
}
function make(turn: number): Named {
  return { a: "a" + turn, b: "b" + turn };
}
function strip(named: Named): Named {
  const { a, ...rest } = named as any;
  return rest;
}
function lengthOfA(named: Named): number {
  const text = named.a;
  return text === undefined ? -1 : text.length;
}
function both(named: Named): string {
  return named.a + named.b;
}
let sum = 0;
const lines: string[] = [];
for (let turn = 0; turn < 20000; turn++) {
  const whole = make(turn);
  const other = turn % 5 ? whole : strip(whole);
  sum += lengthOfA(other) + other.b.length;
  if (turn < 12) lines.push(both(other) + " " + ("a" in other) + " " + Object.keys(other).join());
}
lines.push(String(sum));
console.log(lines.join("\n"));
