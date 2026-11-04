// the text of JSON.stringify goes into the join around it and into a text that grows in a loop. Some rows are turned away half way, one gives undefined, one runs code that changes what the join reads behind the call
type Row = { id: number; name: string };
let counter = 0;
function event(row: Row): string {
  return "data: " + JSON.stringify(row) + "\n\n";
}
function lines(rows: Row[]): string {
  let out = "";
  for (let i = 0; i < rows.length; i++) out += JSON.stringify(rows[i]) + "\n";
  return out;
}
function framed(rows: Row[]): string {
  let out = "[";
  for (let i = 0; i < rows.length; i++) out += i + ":" + JSON.stringify(rows[i]) + ";";
  return out + "]";
}
function counted(row: Row): string {
  return JSON.stringify(row) + counter + "!";
}
function added(row: Row, n: number): unknown {
  return (JSON.stringify(row) as any) + n;
}
const good = (id: number): Row => ({ id, name: "n" + id });
const replaced = (id: number): Row => ({ id, name: { toJSON: () => "replaced " + id } as any });
const nothing = (): Row => ({ toJSON: () => undefined }) as any;
const counting = (): Row => ({ id: 0, name: "c", toJSON: () => "counted " + ++counter }) as any;
console.log(event(good(1)), event(replaced(2)), event(nothing()), event(undefined as any));
console.log(lines([good(1), replaced(2), good(3), nothing(), good(5)]));
console.log(lines([]), lines([good(1)]).length);
console.log(framed([good(1), replaced(2), nothing(), good(4)]));
console.log(counted(good(1)), counted(counting()), counted(counting()));
console.log(added(good(1), 1), added(nothing(), 1), added(undefined as any, 2));
try {
  lines([good(1), { id: 1n, name: "big" } as any, good(3)]);
} catch (e) {
  console.log((e as Error).name);
}
console.log(lines([good(7)]));
let seen = -1;
function noted(row: Row): string {
  return JSON.stringify(row) + ((seen = counter), "!");
}
function summed(row: Row, n: number): string {
  return JSON.stringify(row) + n;
}
function quoted(row: Row): string {
  return `data: ${JSON.stringify(row)}\n\n`;
}
function quotedLines(rows: Row[]): string {
  let out = "";
  for (let i = 0; i < rows.length; i++) out += `${JSON.stringify(rows[i])}\n`;
  return out;
}
console.log(noted(good(1)), seen, noted(counting()), seen, noted(counting()), seen);
console.log(summed(good(1), 1), summed(nothing(), 1), summed(undefined as any, 2));
console.log(quoted(good(1)), quoted(replaced(2)), quoted(nothing()), quoted(undefined as any));
console.log(quotedLines([good(1), replaced(2), nothing(), good(4)]));
