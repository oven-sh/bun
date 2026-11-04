// A definition by a descriptor moves the field out of its slot. The getter runs once a call, in key order, and a hidden field is left out.
function row(id) { return { id, name: "r" + id, last: true }; }
const rows = [row(1), row(2), row(3), row(4)];
let reads = 0;
Object.defineProperty(rows[1], "name", { get() { ++reads; rows[1].last = reads; return "got"; }, enumerable: true, configurable: true });
Object.defineProperty(rows[2], "name", { value: "hidden", enumerable: false });
Object.defineProperty(rows[3], "more", { get() { ++reads; return "more"; }, enumerable: true });
for (let turn = 0; turn < 2; ++turn) {
    for (const each of rows) console.log(JSON.stringify(each));
}
console.log(reads);
