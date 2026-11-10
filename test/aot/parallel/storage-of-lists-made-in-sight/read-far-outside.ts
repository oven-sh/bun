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

function readFarOutside(i: number) { const t = [10, 20, 30, 40]; return [t[i * 1000000000], t[-i], t[i - 1], t[(i << 30) >>> 0]]; }

async function main(): Promise<void> {
  for (let i = 0; i < 6; i++) show("readFarOutside", i, readFarOutside(i));
  console.log(lines.join("\n"));
}

main();
