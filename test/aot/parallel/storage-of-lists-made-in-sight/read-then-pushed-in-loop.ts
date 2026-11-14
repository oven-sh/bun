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

function readThenPushedInLoop(n: number) { const t: any[] = [1, 2, 3, 4]; let out = ""; for (let k = 0; k < n; k++) { out += text(t[k & 3]) + ","; t.push(k === 1 ? 0.5 : k === 3 ? "x" : k); } return out + t.length; }

async function main(): Promise<void> {
  for (let i = 0; i < 6; i++) show("readThenPushedInLoop", i, readThenPushedInLoop(i * 2));
  console.log(lines.join("\n"));
}

main();
