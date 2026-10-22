// `process.argv`, `Bun.main`, `import.meta.main`, `Bun.embeddedFiles` and `$0` of Bun's shell show the program's own name, and no flag of the compiled run reaches its arguments.
import path from "node:path";

console.log(path.basename(process.argv[1]));
console.log(path.basename(Bun.main));
console.log(Bun.main === process.argv[1]);
console.log(import.meta.main);
console.log(Bun.embeddedFiles.length);
console.log((await Bun.$`echo $0`.text()).trim() === Bun.main);
console.log(process.argv.length);
