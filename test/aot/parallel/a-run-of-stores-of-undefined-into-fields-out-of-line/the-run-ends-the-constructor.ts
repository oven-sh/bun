// Nothing is stored behind the run: the order of the names has to be written by the run itself, and what looks at the object next sees all of them.
// Under: --aot-check=Validate
class Row {
    id: number; first?: object; second?: object; third?: object;
    constructor(id: number) { this.id = id; this.first = undefined; this.second = undefined; this.third = undefined; }
}
function seen(row: Row) { const names: string[] = []; for (const name in row) names.push(name); return names.join(); }
function fill(row: Row, value: object) { row.second = value; }
const turns = JSON.parse("3");
for (let i = 0; i < turns; i++) {
    const row = new Row(i);
    console.log(seen(row), Object.getOwnPropertyNames(row).length, Object.entries(row).map(([name, value]) => name + "=" + value).join());
    fill(row, { n: i }); console.log(seen(row), JSON.stringify(row));
}
