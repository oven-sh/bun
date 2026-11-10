function adder(step) {
    return x => x + step;
}
const table = { adder, size: 3 };
const key = process.argv[3] ?? "size";
const add = adder(3);
console.log("SAID p2 " + typeof table[key] + " " + add(1) + " " + add(2));
