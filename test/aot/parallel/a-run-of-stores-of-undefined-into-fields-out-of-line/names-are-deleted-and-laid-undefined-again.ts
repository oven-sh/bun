// Optional fields are laid undefined at the birth, filled, deleted and laid undefined again, by the constructor's own text and by strangers: a name that is not listed has an empty slot, whatever stood there before.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: where a store of undefined creates a listed field and lays nothing, the slot is asked whether it is empty
class Row {
    id: number; first?: object; second?: object; third?: object; fourth?: object; last: number;
    constructor(id: number) { this.id = id; this.first = undefined; this.second = undefined; this.third = undefined; this.fourth = undefined; this.last = id + 1; }
}
function make(id: any) { return new Row(id); }
function fill(row: Row, value: object) { row.second = value; row.fourth = value; }
function drop(row: Row) { delete row.second; delete row.third; }
function again(row: Row) { row.third = undefined; row.second = undefined; }
function told(row: Row) { return Object.keys(row).join() + " " + JSON.stringify(row) + " " + ("second" in row) + " " + Object.hasOwn(row, "third") + " " + String(row.second) + " " + String(row.fourth); }
const turns = JSON.parse("4"), given: object[] = JSON.parse('[{"n":1},{"n":2}]'), ids: any[] = JSON.parse("[5,6,7,8]");
for (let i = 0; i < turns; i++) {
    const row = make(ids[i]); console.log(told(row));
    if (i & 1) { fill(row, given[i >> 1]); console.log(told(row)); }
    drop(row); console.log(told(row));
    again(row); console.log(told(row));
    fill(row, given[0]); console.log(told(row));
}
