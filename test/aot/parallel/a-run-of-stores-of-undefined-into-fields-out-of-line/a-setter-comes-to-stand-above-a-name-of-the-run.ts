// A setter is laid on the prototype under the third name of the run: from then on the store under that name calls it, and the names beside it are still created.
// Under: --aot-check=Validate
class Row {
    id: number; first?: object; second?: object; third?: object; fourth?: object;
    constructor(id: number) { this.id = id; this.first = undefined; this.second = undefined; this.third = undefined; this.fourth = undefined; }
}
function fill(row: Row, value: object) { row.first = value; row.third = value; }
const turns = JSON.parse("4"); let calls = 0;
for (let i = 0; i < turns; i++) {
    if (i === 2) Object.defineProperty(Row.prototype, "third", { set(value) { calls++; }, get() { return "above"; }, configurable: true });
    const row = new Row(i);
    console.log(Object.keys(row).join(), Object.hasOwn(row, "third"), String(row.third), calls);
    fill(row, { n: i }); console.log(Object.keys(row).join(), JSON.stringify(row), calls);
}
