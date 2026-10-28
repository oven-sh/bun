// A loop calls a function that hands back one of three functions, and calls what it gets twice. One of the three is a declared function that nobody has asked for until the third turn.
// The build counts the program as very large, so the function that chooses is called and not written into the loop.
function twice(f: (x: number) => number, x: number): number { return f(f(x)) }
function adder(n: number): (x: number) => number { return x => x + n }
function pick(i: number): (x: number) => number { return i % 3 === 0 ? x => x * 2 : i % 3 === 1 ? adder(i) : square }
function square(x: number): number { return x * x }
let total = 0
for (let i = 0; i < 9; i++) total += twice(pick(i), i + 1)
console.log(total, twice(square, 3), adder(5)(6), square === square, typeof square, typeof adder(1))
