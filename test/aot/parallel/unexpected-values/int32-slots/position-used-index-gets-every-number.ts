// A position that is used as an index gets every number that is no int32.
class Cursor {
    position: number = 0;
    weight: number = 0.5;
    constructor(public text: string) {}
    peek(): number {
        return this.text.charCodeAt(this.position);
    }
    rest(): string {
        return this.text.substring(this.position);
    }
}
function show(value: unknown): string {
    return Object.is(value, -0) ? "-0" : String(value);
}
const given = JSON.parse("[1, 1.5, 4294967296, -1, -0, 2147483647, 2147483648, -2147483648, -2147483649, -2147483644, -2147483643, 1e21, 0.1]") as number[];
const values: number[] = [...given, NaN, Infinity, -Infinity, 3];
const table = [10, 20, 30, 40];
const cursor = new Cursor("abcdef");
for (const value of values) {
    cursor.position = value;
    console.log(
        Object.is(cursor.position, value),
        show(cursor.position),
        show(cursor.peek()),
        JSON.stringify(cursor.rest()),
        show(table[cursor.position]),
        show(cursor.position + 1),
        show(1 / cursor.position),
        show(cursor.position | 0),
        typeof cursor.position,
        JSON.stringify(cursor),
    );
}
const many: Cursor[] = [];
for (let i = 0; i < 2000; i++) {
    const one = new Cursor("abcdef");
    one.position = values[i % values.length];
    many.push(one);
}
let sum = 0;
let codes = 0;
for (const one of many) {
    if (Number.isFinite(one.position))
        sum += one.position;
    const code = one.peek();
    if (code === code)
        codes += code;
}
console.log(sum, codes);
for (const one of many)
    one.position = 2;
console.log(many.every(one => one.position === 2 && one.peek() === 99), Object.keys(many[1]).join());
