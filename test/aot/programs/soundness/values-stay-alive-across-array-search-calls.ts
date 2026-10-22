// Integers, doubles, strings and objects that a caller holds across `indexOf` and `includes`, more of them than there are registers, with search elements that take every path of the search.
const names = ["", "alice", "bob", "carol", "dave"];
const numbers = [1, 2, 3, 4, 5];
const doubles = [0.5, 1.5, 2.5, 3.5];
const marker = { name: "marker" };
const mixed: unknown[] = ["alice", 2, marker, null, undefined, 2.5, "bob"];

function copyOf(text: string): string {
  return text.split("").join("");
}

function loopCounter(list: string[], wanted: string): string {
  let line = "counter:";
  for (let i = 0; i < 4; i++) line += " " + list.indexOf(wanted) + "+";
  return line;
}

function positions(list: string[], wanted: string[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < wanted.length; i++) result.push(list.indexOf(wanted[i]));
  return result;
}

function countPresent(list: string[], wanted: string[]): number {
  let found = 0;
  for (let i = 0; i < wanted.length; i++) if (list.includes(wanted[i])) found++;
  return found;
}

function nestedText(list: string[], wanted: string): string {
  let line = "nested:";
  for (const start of [0, 1, 2, -1]) line += " " + list.indexOf(wanted, start) + (list.includes(wanted, start) ? "+" : "-");
  return line;
}

function manyIntegers(list: unknown[], wanted: unknown, seed: number): string {
  let a = seed | 0, b = a + 1, c = a + 2, d = a + 3, e = a + 4, f = a + 5, g = a + 6, h = a + 7;
  let i = a + 8, j = a + 9, k = a + 10, l = a + 11, m = a + 12, n = a + 13, o = a + 14, p = a + 15;
  let total = 0;
  for (let round = 0; round < 3; round++) {
    const at = list.indexOf(wanted);
    const has = list.includes(wanted);
    total += at + (has ? 100 : 0);
    a += b; b += c; c += d; d += e; e += f; f += g; g += h; h += i;
    i += j; j += k; k += l; l += m; m += n; n += o; o += p; p += at;
  }
  return [total, a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p].join(",");
}

function manyDoubles(list: unknown[], wanted: unknown, seed: number): string {
  let a = seed + 0.25, b = a * 2, c = a * 3, d = a * 4, e = a * 5, f = a * 6, g = a * 7, h = a * 8;
  let i = a * 9, j = a * 10, k = a * 11, l = a * 12, m = a * 13, n = a * 14, o = a * 15, p = a * 16;
  let total = 0;
  for (let round = 0; round < 3; round++) {
    const at = list.indexOf(wanted);
    const has = list.includes(wanted);
    total += at + (has ? 0.5 : 0);
    a += b; b += c; c += d; d += e; e += f; f += g; g += h; h += i;
    i += j; j += k; k += l; l += m; m += n; n += o; o += p; p += at;
  }
  return [total, a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p].join(",");
}

function manyCells(list: unknown[], wanted: unknown): string {
  const a = { v: "a" }, b = { v: "b" }, c = { v: "c" }, d = { v: "d" }, e = { v: "e" }, f = { v: "f" }, g = { v: "g" }, h = { v: "h" };
  const s = copyOf("s"), t = copyOf("t"), u = copyOf("u"), w = copyOf("w");
  let line = "";
  for (let round = 0; round < 2; round++) {
    const at = list.indexOf(wanted);
    const has = list.includes(wanted);
    line += a.v + b.v + c.v + d.v + e.v + f.v + g.v + h.v + s + t + u + w + at + has + ";";
  }
  return line;
}

function thrownFromConversion(list: string[]): string {
  let kept = 41;
  const text = copyOf("kept");
  const start: any = { valueOf() { throw new Error("start"); } };
  try {
    kept++;
    list.indexOf("bob", start);
  } catch (error) {
    return text + " " + kept + " " + (error as Error).message;
  }
  return "no exception";
}

console.log(loopCounter(names, copyOf("alice")));
console.log(loopCounter(names.map(copyOf), "dave"));
console.log(loopCounter(names, "erin"));
console.log(positions(names, ["carol", "bob", "erin", ""].map(copyOf)).join(","));
console.log(countPresent(names.map(copyOf), ["carol", "bob", "erin", "alice"]));
console.log(nestedText(names.map(copyOf), copyOf("bob")));
for (const [list, wanted] of [[names, copyOf("carol")], [names, "erin"], [numbers, 4], [numbers, 4.5], [doubles, 2.5], [doubles, NaN], [mixed, copyOf("bob")], [mixed, marker], [mixed, undefined], [mixed, null], [mixed, 2.5], [[], "a"]] as [unknown[], unknown][]) {
  console.log(manyIntegers(list, wanted, 3));
  console.log(manyDoubles(list, wanted, 3));
  console.log(manyCells(list, wanted));
}
console.log(thrownFromConversion(names));
