function make() {
    let count = 0;
    return { next: () => ++count };
}
const table = { make, size: 3 };
const key = process.argv[3] ?? "size";
const made = make();
const next = () => made.next();
console.log("SAID p3 " + typeof table[key] + " " + next() + " " + next());
