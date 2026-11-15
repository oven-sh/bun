// In a loop calls of a method that four classes below one that lacks it define stand inside one another in one statement, SIZE deep.
// It writes a program: SIZE says how deep, PASSES how many copies of its function under names of their own.
// Sizes: 4 8 16
// Passes: 32
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["class Base {}"];
["A", "B", "C", "D"].forEach((name, at) =>
  out.push(`class ${name} extends Base { f(x) { return ((x | 0) * ${[2, 3, 5, 7][at]} + ${at + 1}) | 0; } }`),
);
let call = "";
for (let level = size; level-- > 0; ) call = `list[(i + ${level}) & 3].f(${call})`;
for (let copy = 0; copy < copies; copy++) {
  out.push(
    `function run${copy}(list, turns) {`,
    "  let total = 0;",
    `  for (let i = 0; i < turns; i++) total = (total + ${call}) | 0;`,
    "  return total;",
    "}",
  );
}
out.push("const list = [new A(), new B(), new C(), new D()];", "let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`told = (told + run${copy}(list, 40)) | 0;`);
out.push("console.log(told);");
console.log(out.join("\n"));
