function make() {
    let count = 0;
    return () => ++count;
}
const table = { make, size: 3 };
const key = process.argv[3] ?? "make";
const next = make();
const other = table[key]();
console.log("SAID kind " + typeof table[key]);
console.log("SAID first " + next());
console.log("SAID second " + next());
console.log("SAID other " + other());
