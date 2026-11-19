// What is printed is what plain Bun prints.
let tree: any = { x: 1 }; for (let i = 0; i < 40; i++) tree = { a: tree, b: tree };
const o: any = { toString: JSON.stringify.bind(null, tree) };
if (process.argv[2] === "never") console.log("" + o);
console.log(new RegExp(process.argv[3] ?? "a").test("a"));
