// What is printed is what plain Bun prints.
const r: any = /a/; Object.defineProperty(r, "global", { value: true });
if (process.argv[2] === "never") (RegExp.prototype as any)[Symbol.replace].call(r, "aa", "b");
console.log(new RegExp(process.argv[3] ?? "a").test("a"));
