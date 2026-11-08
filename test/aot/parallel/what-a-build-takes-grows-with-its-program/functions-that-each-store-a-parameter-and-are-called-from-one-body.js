// SIZE functions each store their parameter in a variable of the module, and one body calls each of them once with a function of its own.
// It writes a program: SIZE says how many such functions and calls there are.
// Sizes: 2000 4000 8000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 4);
const out = [];
for (let index = 0; index < size; index++) {
  out.push(`let held${index}: (x: number) => number = x => x;`);
  out.push(`function keep${index}(given: (x: number) => number): void { held${index} = given; }`);
  out.push(`function given${index}(x: number): number { return (x + ${index}) | 0; }`);
}
out.push("function lay(): void {");
for (let index = 0; index < size; index++) out.push(`  keep${index}(given${index});`);
out.push("}");
out.push("lay();");
out.push("let told = 0;");
for (let index = 0; index < size; index += Math.max(1, size >> 3)) out.push(`told = (told + held${index}(1)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
