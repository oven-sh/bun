// What is printed is what plain Bun prints.
if (process.argv[2] === "never") String.raw({ raw: { length: 2 ** 53 - 1 } } as any);
console.log(new RegExp(process.argv[3] ?? "a").test("a"));
