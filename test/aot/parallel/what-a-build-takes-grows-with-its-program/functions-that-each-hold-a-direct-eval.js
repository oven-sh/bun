// SIZE functions of one file each hold a direct eval. The text of each can name every function of the file, so each eval listed SIZE names:
// SIZE times SIZE pairs went through the binder, the scope plan, the records of the program, the image and the run time.
// The names of a file are listed once, and each eval names that list.
// It writes a program: SIZE says how many functions.
// Sizes: 250 500 1000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 3);
const out = ["let told = 0;"];
for (let i = 0; i < size; i++) out.push(`function look${i}(text) { return eval(text); }`);
for (let i = 0; i < size; i++) out.push(`told += look${i}("typeof look${(i + 1) % size} === 'function' ? ${i} : -1");`);
out.push("console.log(told);");
console.log(out.join("\n"));
