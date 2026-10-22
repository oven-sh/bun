// Callbacks handed over: without an initial value reduce passes the first element as the accumulator, then whatever the callback returned, and the index and the array behind them; the program's own calls pass strings.
let total = 0;

function join(all: string, one: string): string {
  total += typeof all === "string" ? 1 : typeof all === "number" ? 100 : 10000;
  total += typeof one === "string" ? 100000 : one === null ? 1000000 : 10000000;
  return all + one;
}

join("a", "b");
const rows: any[] = [1, "a", null, [2]];
const results = [rows.reduce(join), rows.reduceRight(join), rows.reduce(join, "start"), [5].reduce(join as any), (Array.prototype.reduce as any).call("xyz", join)];
console.log(total, results.join(" "));
