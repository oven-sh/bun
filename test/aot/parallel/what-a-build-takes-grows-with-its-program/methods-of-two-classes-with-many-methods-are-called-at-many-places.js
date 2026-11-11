// Two classes have SIZE methods each under the same names, and at SIZE places one of the first hundred names is called on an object that is of either class.
// It writes a program: SIZE says how many methods a class has and how many calls there are.
// Sizes: 1500 3000 12000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2);
const out = ["let count = 0;"];
for (const name of ["Left", "Right"]) {
  out.push(`class ${name} {`);
  for (let at = 0; at < size; at++) out.push(`  m${at}() { count++; }`);
  out.push("}");
}
const callsInOneFunction = 100;
let functions = 0;
for (let first = 0; first < size; first += callsInOneFunction, functions++) {
  out.push(`function use${functions}(side: Left | Right) {`);
  for (let at = first; at < Math.min(size, first + callsInOneFunction); at++) out.push(`  side.m${at % 100}();`);
  out.push("}");
}
out.push("const left = new Left(), right = new Right();");
for (let at = 0; at < functions; at++) out.push(`use${at}(left); use${at}(right);`);
out.push("console.log(count);");
console.log(out.join("\n"));
