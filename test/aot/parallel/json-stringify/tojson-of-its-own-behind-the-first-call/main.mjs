// The second turn finds a toJSON on the object itself, laid there under a key that no statement names.
function row(id) { return { id, name: "r" + id }; }
const one = row(1);
const name = ["to", "JSON"].join("");
for (let turn = 0; turn < 3; ++turn) {
    console.log(JSON.stringify(one), JSON.stringify({ inner: one }));
    if (turn === 0) one[name] = function () { return "own " + this.id; };
    if (turn === 1) delete one[name];
}
