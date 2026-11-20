// SIZE functions are handed one object and store into it, and SIZE reads name a file by it. Whether the object is kept as written was asked anew for each of the reads, and for each of its
// mentions the list of all its members was made.
// It writes a program: SIZE says how many functions and reads there are.
// Sizes: 120 240 480
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 4);
let text = `import fs from "node:fs";\nconst state = { root: process.argv[9] ?? "nothing" };\n`;
for (let i = 0; i < size; i++) text += `function store${i}(state) { state.v${i} = ${i}; return state.root; }\n`;
for (let i = 0; i < size; i++) text += `if (process.argv.length > ${i + 9}) console.log(fs.readFileSync(store${i}(state) + "/y").length);\n`;
text += `console.log(state.root);\n`;
console.log(text);
