// createRequire is called on a copy of node:module that may also be a value the compiler knows nothing about.
import Module from "node:module";
const name = ["node:", "net"].join("");
let copies = [{ ...Module }];
if (process.argv.length > 5) copies = globalThis[process.argv[5]];
for (const copy of copies) {
  const step = { next: () => copy.createRequire(import.meta.url) };
  console.log(typeof step.next()(name).Socket);
}
