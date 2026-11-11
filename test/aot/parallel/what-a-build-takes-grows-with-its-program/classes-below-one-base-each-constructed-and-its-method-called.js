// SIZE classes extend one base; each stores to this behind super(), is constructed once at the top level, and its method is called by name there.
// It writes a program: SIZE says how many such classes there are.
// Sizes: 500 1000 2000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 4);
const out = [];
out.push("abstract class Base { abstract area(): number; }");
out.push("let sum = 0;");
for (let index = 0; index < size; index++) {
  out.push(`class C${index} extends Base { constructor(public a: number, public b${index}: number) { super(); } area() { return this.a * this.b${index}; } }`);
  out.push(`sum += new C${index}(${index % 7}, 2).area();`);
}
out.push("console.log(sum);");
console.log(out.join("\n"));
