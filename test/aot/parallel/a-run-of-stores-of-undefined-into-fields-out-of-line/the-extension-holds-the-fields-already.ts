// The first optional field is given a value, which makes room for those behind it: the undefined that follows has to be written into that room, or the fields would read as missing.
// Under: --aot-check=Validate
class Row {
    id: number; first?: object; second?: object; third?: object; fourth?: object;
    constructor(id: number, first: object | undefined) { this.id = id; this.first = first; this.second = undefined; this.third = undefined; this.fourth = undefined; }
}
function fill(row: Row, value: object) { row.fourth = value; row.second = value; }
const turns = JSON.parse("4");
for (let i = 0; i < turns; i++) {
    const row = new Row(i, i & 1 ? { n: i } : undefined);
    console.log(Object.keys(row).join(), JSON.stringify(row), "second" in row, Object.hasOwn(row, "third"), Object.hasOwn(row, "fourth"), row.second, row.fourth);
    if (i > 1) { fill(row, { m: i }); console.log(Object.keys(row).join(), JSON.stringify(row), row.third); }
}
