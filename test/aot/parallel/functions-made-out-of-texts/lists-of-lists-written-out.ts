// What is printed is what plain Bun prints.
let list: any = ["x"]; for (let i = 0; i < 40; i++) list = [list, list];
if (process.argv[2] === "never") JSON.stringify(list);
console.log(new RegExp(process.argv[3] ?? "a").test("a"));
