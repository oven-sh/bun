// The constructor branches between its stores, and is handed what fits and what does not by turns: whichever version runs, the names come in the order written on the way taken.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what stands behind the guard is held against what arrives
class Row {
    flags: number; name: string; first?: object; second?: object; id: number; kind: string;
    constructor(flags: number, name: string) { this.flags = flags; this.name = name; if (flags & 1) { this.kind = "odd"; this.first = undefined; } else { this.kind = "even"; this.second = undefined; } this.id = 0; }
}
function make(flags: any, name: any) { return new Row(flags, name); }
function fill(row: Row, value: object) { row.first = value; row.second = value; }
const flags: any[] = JSON.parse('[1, 2, 2.5, "3", null, true, {"n": 1}, -1, 4294967297]'); flags.push(undefined, NaN);
const names: any[] = JSON.parse('["n", 7, null, {"n": 1}, "", false]'); names.push(undefined);
for (const flag of flags) for (const name of names) { const row = make(flag, name); console.log(Object.keys(row).join(), typeof row.flags, String(row.flags), typeof row.name, String(row.name), row.kind, row.id, "first" in row, "second" in row); fill(row, names); console.log(Object.keys(row).join(), row.first === names); }
