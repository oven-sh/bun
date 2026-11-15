function three(this: unknown, a: number, b: number, c: number): string { return String(this) + a + b + c; }
const one = three.bind("first", 1), two = one.bind("second", 2);
let text = "";
for (let round = 0; round < 5; round++) text += two(round) + one(round, round) + ";";
console.log(text, two.name, two.length);
