function make() {
    let count = 0;
    return () => ++count;
}
const table = { make, size: 3 };
let next;
const key = process.argv[3] ?? "size";
for (let i = 0; i < table.size; ++i)
    next = make();
console.log("SAID p7 " + typeof table[key] + " " + next() + " " + next());
