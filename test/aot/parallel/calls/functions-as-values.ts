// Functions as values: called by code that knows them, by code that does not, and by built-in functions.
function twice(f: (x: number) => number, x: number): number { return f(f(x)) }
function adder(n: number): (x: number) => number { return x => x + n }
function pick(i: number): (x: number) => number { return i % 3 === 0 ? x => x * 2 : i % 3 === 1 ? adder(i) : square }
function square(x: number): number { return x * x }
function many(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + k * 11 }
let total = 0
for (let i = 0; i < 9; i++) total += twice(pick(i), i + 1)
console.log(total, twice(square, 3), adder(5)(6), square === square, typeof square, typeof adder(1))
console.log(many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), many(0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5))
const list = [3, 1, 2]
console.log(list.map(adder(10)).join(","), list.map(square).join(","), list.filter(x => x > 1).length, square.length, square.name, adder(1).length)
let count = 0
const bump = () => { count++ }
bump(); bump()
list.forEach(bump)
console.log(count)
