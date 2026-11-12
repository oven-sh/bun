// A function is made out of a text and called at the start; a RegExp is made behind it. What is printed is what plain Bun prints.
const wait = Function.call(null, "while (typeof process === 'undefined');");
wait();
console.log(new RegExp(process.argv[2] ?? "a").test("a"));
