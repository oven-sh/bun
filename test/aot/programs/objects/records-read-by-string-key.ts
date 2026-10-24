// Records read by keys whose type is string: what is in the object, what is beside it, what is inherited, and what is nowhere, before and after it arrives.
type Table = Record<string, number | string | undefined>;
function read(table: Table, key: string): unknown { return table[key]; }
const lines: string[] = [];
const small: Table = { a: 1, b: "two" };
const large: Table = {};
for (let i = 0; i < 40; i++) large["n" + i] = i;
const names = ["a", "b", "c", "n0", "n5", "n6", "n7", "n39", "n40", "toString", "constructor", "__proto__", "length", ""];
function row(what: string, table: Table): void {
    lines.push(what + ": " + names.map(name => { const found = read(table, name) as unknown; return typeof found === "function" ? "function" : typeof found === "object" ? "object" : String(found); }).join());
}
for (let round = 0; round < 3; round++) { row("small", small); row("large", large); }
small.c = 3;
row("small with c", small);
delete small.a;
row("small without a", small);
small.a = "back";
row("small with a again", small);
large.n40 = "forty";
row("large with n40", large);

const parent: Table = { c: "from the parent" };
const heir: Table = Object.create(parent);
heir.a = 1;
row("heir", heir); row("heir", heir);
parent.n5 = "arrived on the parent";
row("heir after the parent got n5", heir);
delete parent.c;
row("heir after the parent lost c", heir);
const bare: Table = Object.create(null);
bare.b = 2;
row("bare", bare); row("bare", bare);
Object.setPrototypeOf(bare, parent);
row("bare with a parent", bare);
const computed: Table = { get a() { return "got"; }, b: 1 } as Table;
row("with a getter", computed); row("with a getter", computed);

// The same key, many tables of one shape and of many; what is nowhere stays nowhere until a table gets it.
let sum = 0;
const tables: Table[] = [];
for (let i = 0; i < 300; i++) { const table: Table = { x: i }; if (i % 3 === 0) table["y" + (i % 7)] = i; tables.push(table); }
for (let round = 0; round < 20; round++) {
    for (const table of tables) {
        sum += read(table, "x") as number;
        if (read(table, "late") !== undefined) sum += 1000000;
        if (read(table, "y3") !== undefined) sum += 1;
    }
    if (round === 10) tables[7].late = 1;
}
lines.push("sum " + sum);
console.log(lines.join("\n"));
