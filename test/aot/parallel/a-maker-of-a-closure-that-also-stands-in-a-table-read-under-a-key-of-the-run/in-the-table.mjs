function make() {
    let count = 0;
    return () => ++count;
}
const table = { make, size: 3 };
const key = process.argv[3] ?? "size";
const next = make();
console.log("SAID p1 " + typeof table[key] + " " + next() + " " + next());
