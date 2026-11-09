// SIZE lines of one file each read a name off `import threads = require("node:worker_threads")`, and one export list names SIZE variables. Whether the
// load follows the alias is asked at every read. The answer is a flag of the alias: it does not go through the export list.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 4000 8000 16000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2);
const out = ['import threads = require("node:worker_threads");'];
for (let at = 0; at < size; at++) out.push(`const v${at} = threads.threadId + ${at};`);
out.push(`export { ${Array.from({ length: size }, (_, at) => `v${at}`).join(", ")} };`);
out.push(`console.log(v0 + v${size - 1});`);
console.log(out.join("\n"));
