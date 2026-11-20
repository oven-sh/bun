function make() {
    let count = 0;
    return () => ++count;
}
let next;
function start() { next = make(); }
const table = { start, size: 3 };
const key = process.argv[3] ?? "size";
start();
console.log("SAID p4 " + typeof table[key] + " " + next() + " " + next());
