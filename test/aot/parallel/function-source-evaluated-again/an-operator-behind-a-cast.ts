// `a + b as number * c` is `(a + b) * c`, and so is the text of the function when it is evaluated again.
function scaled(a: number, b: number, c: number) { return a + b as number * c; }
const raised = (a: number, b: number, c: number) => a * b satisfies number ** c;
class Meter { reading(a: number, b: number, c: number) { return a - b as any as number / c; } }
const again = (text: string) => (0, eval)("(" + text + ")");
console.log(scaled(1, 2, 10), again(String(scaled))(1, 2, 10));
console.log(raised(2, 3, 2), again(String(raised))(2, 3, 2));
console.log(new Meter().reading(9, 1, 4), again("{" + String(Meter.prototype.reading) + "}").reading(9, 1, 4));
