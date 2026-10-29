// `import { a } from "bun"` runs as `var { a } = Bun` where the statement stands: ahead of it the name holds undefined, for the body of the file and for a function alike.
console.log(typeof embeddedFiles, typeof readInFunction(), typeof argv);
import { embeddedFiles, argv, nanoseconds as ns } from "bun";
import { version } from "bun";
function readInFunction() {
  return embeddedFiles;
}
console.log(typeof embeddedFiles, typeof readInFunction(), typeof argv, typeof ns, typeof ns(), typeof version);
try {
  throw 1;
} catch {
  console.log(typeof argv, argv === Bun.argv);
}
for (let i = 0; i < 2; i++) console.log(i, typeof version, argv.length > 0);
if (argv) console.log("argv is truthy");
await 0;
console.log(typeof argv, typeof version);
class C {
  static a = typeof version;
  b = typeof argv;
}
console.log(C.a, new C().b);
export { ns };
