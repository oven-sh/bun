// A constructor lays undefined in four optional fields one behind the other: the object lists them in the order written, each is its own and reads undefined.
// Under: --aot-check=Validate
class Row {
    id: number; first?: object; second?: object; third?: object; fourth?: object; last: number;
    constructor(id: number) { this.id = id; this.first = undefined; this.second = undefined; this.third = undefined; this.fourth = undefined; this.last = id + 1; }
}
function fill(row: Row, value: object) { row.third = value; row.first = value; }
const turns = JSON.parse("3");
for (let i = 0; i < turns; i++) {
    const row = new Row(i);
    console.log(Object.keys(row).join(), JSON.stringify(row), "second" in row, Object.hasOwn(row, "fourth"), row.first, row.fourth);
    if (i === 1) { fill(row, { n: i }); console.log(Object.keys(row).join(), JSON.stringify(row), row.second, row.fourth); }
}
