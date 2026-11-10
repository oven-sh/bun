function make() {
    let count = 0;
    return () => ++count;
}
const table = { make, size: 3 };
const key = process.argv[3] ?? "size";
const other = make();
const next = make();
other();
console.log("SAID p6 " + typeof table[key] + " " + next() + " " + next());
