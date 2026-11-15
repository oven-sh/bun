// SIZE functions hand a path on to two others each, so that each can be reached from each, and each reads the file that it names. What the path may be leans on itself on every way, and
// each of the reads followed those ways until it had spent twice the expressions of the file.
// It writes a program: SIZE says how many functions there are.
// Sizes: 150 300 600
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 4);
let text = `import fs from "node:fs";\nlet reads = 0;\nfunction clean(path) { return path.replace("\\\\", "/"); }\n`;
for (let i = 0; i < size; i++) {
  text += `function read${i}(path) { if (path.length > 40) return reads; if (fs.existsSync(path)) reads += fs.readFileSync(path).length; read${(i * 3 + 1) % size}(clean(path) + "/x"); return read${(i * 5 + 2) % size}(path.slice(1)); }\n`;
}
text += `if (process.argv.length > 9) read0(process.argv[9]);\nconsole.log(reads);\n`;
console.log(text);
