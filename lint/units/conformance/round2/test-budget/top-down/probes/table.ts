// bun table.ts <min ms> <log> [<log> ...]: the tests of the logs of `bun test` side by side, in milliseconds; a test is
// shown when one log has it at the given time or more. "F" marks a failure, "-" a test that a log does not have.
const [minText, ...logs] = process.argv.slice(2);
const min = Number(minText);
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rows = new Map<string, (string | undefined)[]>();
const order: string[] = [];
logs.forEach((log, k) => {
  for (const line of strip(require("node:fs").readFileSync(log, "utf8")).split("\n")) {
    const m = /^(?:\((pass|fail)\)|(✓|✗)) (.*) \[([0-9.]+)ms\]$/.exec(line);
    if (m === null) continue;
    const failed = m[1] === "fail" || m[2] === "✗";
    let row = rows.get(m[3]);
    if (row === undefined) {
      rows.set(m[3], (row = new Array(logs.length).fill(undefined)));
      order.push(m[3]);
    }
    // A failed test is printed twice: once in place and once in the summary.
    row[k] = `${Math.round(Number(m[4]))}${failed ? "F" : ""}`;
  }
});
console.log(logs.map((l, k) => `[${k + 1}] ${l.split("/").pop()}`).join("\n"));
const sums = new Array(logs.length).fill(0);
for (const name of order) {
  const row = rows.get(name)!;
  row.forEach((v, k) => (sums[k] += parseInt(v ?? "0")));
  if (!row.some(v => v !== undefined && (parseInt(v) >= min || v.endsWith("F")))) continue;
  console.log(row.map(v => (v ?? "-").padStart(7)).join(" ") + "  " + name.slice(0, 110));
}
console.log(sums.map(v => String(v).padStart(7)).join(" ") + "  sum of the times of all tests (tests that run at the same time count each)");
