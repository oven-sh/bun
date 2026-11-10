// SIZE classes below one class have a method of their own under one name, and a list that holds one object of each is summed in a loop.
// It writes a program: SIZE says how many classes, PASSES how many copies of the function that sums under names of their own.
// Sizes: 300 600 2400
// Passes: 400
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = ["class Part { constructor(n) { this.n = n; } weigh() { return this.n; } }"];
for (let at = 0; at < size; at++) out.push(`class Part${at} extends Part { weigh() { return this.n + ${at}; } }`);
const made = [];
for (let at = 0; at < size; at++) made.push(`new Part${at}(${at % 7})`);
out.push(`const parts = [${made.join(", ")}];`);
for (let copy = 0; copy < copies; copy++) {
  out.push(
    `function sum${copy}(list) {`,
    `  let total = ${copy};`,
    "  for (let i = 0; i < list.length; i++) total += list[i].weigh();",
    "  return total;",
    "}",
  );
}
out.push("let all = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`all += sum${copy}(parts);`);
out.push("console.log(all);");
console.log(out.join("\n"));
