// What is printed is what plain Bun prints.
const r: any = /a/; Object.defineProperty(r, "flags", { value: "g" });
if (process.argv[2] === "never") Reflect.apply(String.prototype.replace, "aa", [r, "b"]);
console.log(new RegExp(process.argv[3] ?? "a").test("a"));
