const lines: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function describe(list: any[]): string {
  let out = "[" + list.length + ":";
  for (let k = 0; k < list.length && k < 10; k++) out += (k in list ? text(list[k]) : "hole") + ",";
  return out + "]";
}

function show(label: string, i: number, value: unknown): void {
  lines.push(label + " " + i + " " + (Array.isArray(value) ? describe(value) : text(value)));
}
function meddle(list: any[], how: number): void {
  if (how === 1) list[1] = "meddled";
  else if (how === 2) list.length = 1;
  else if (how === 3) list.push(0.5);
  else if (how === 4) list[1] = 0.25;
  else if (how === 5) delete list[2];
}
function make(): number[] { return [1, 2, 3, 4]; }
const numbers = [5, 2.5, NaN, -0, 2147483648, -1];
const values: unknown[] = ["text", 1, 0.5, null, undefined, NaN];

function readThenFilledInLoop(n: number, x: unknown) { const t: any[] = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; if (k === 2) t.fill(x); } return out; }

async function main(): Promise<void> {
  for (let i = 0; i < 6; i++) show("readThenFilledInLoop", i, readThenFilledInLoop(8, values[i]));
  console.log(lines.join("\n"));
}

main();
