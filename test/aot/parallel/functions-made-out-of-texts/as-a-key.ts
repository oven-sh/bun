// What is printed is what plain Bun prints.
let list: any = ["x"]; for (let i = 0; i < 40; i++) list = [list, list];
const held: any = {};
if (process.argv[2] === "never") console.log(held[list], list in held);
console.log(new RegExp(process.argv[3] ?? "a").test("a"));
