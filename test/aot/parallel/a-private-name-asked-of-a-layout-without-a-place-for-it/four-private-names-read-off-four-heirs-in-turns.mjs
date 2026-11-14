// A private name read off an instance of an heir, where the compiler does not know the receiver, is found by a stub in a table of 64 rows under the layout and the field.
// The row was chosen by `layout ^ field`: neighbouring layouts and neighbouring fields fell on one row and drove each other out at every read, and each such read went to the run time.
// The field is shifted by three now: four names on four heirs have sixteen rows.
class Base { #a = 1; #b = 2; #c = 3; #d = 4; static a(o) { return o.#a; } static b(o) { return o.#b; } static c(o) { return o.#c; } static d(o) { return o.#d; } }
class Else { #a = 9; static a(o) { return o.#a; } }
const pick = process.argv.length > 50 ? 1 : 0, parents = [Base, Else];
class One extends parents[pick] { p = 1; } class Two extends parents[pick] { q = 2; } class Three extends parents[pick] { r = 3; } class Four extends parents[pick] { s = 4; }
const all = JSON.parse("[0,1,2,3]").map((kind) => (kind === 0 ? new One() : kind === 1 ? new Two() : kind === 2 ? new Three() : new Four()));
const asks = JSON.parse("[0,1,2,3]").map((which) => [Base.a, Base.b, Base.c, Base.d][which]);
let sum = 0;
for (let turn = 0; turn < 500; turn++) for (const o of all) for (const ask of asks) sum += ask(o);
console.log(sum);
