// One body calls a built-in that has several rows, console.log, SIZE times.
// It writes a program: SIZE says how many such calls the body of the module holds.
// Sizes: 1000 2000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 4);
const out = ["let told = JSON.parse('0');"];
for (let index = 0; index < size; index++) out.push(`if (told > ${index}) console.log("a", told);`);
out.push("console.log(told);");
console.log(out.join("\n"));
