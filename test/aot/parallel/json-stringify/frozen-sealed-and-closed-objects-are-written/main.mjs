// The three levels set bits of the order word beside the order and the count. The text is that of any other object.
function row(id) { return { id, name: "r" + id, inner: { id } }; }
const rows = [row(0), Object.freeze(row(1)), Object.seal(row(2)), Object.preventExtensions(row(3))];
Object.freeze(rows[1].inner);
for (let turn = 0; turn < 2; ++turn) {
    for (const each of rows) console.log(JSON.stringify(each), Object.isFrozen(each));
}
