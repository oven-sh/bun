// What is no createRequire of node:module by its binding, or sits in a variable that is stored to, is followed by nobody. A require that is made for another place finds a library module under a constant name, as from every file. The output is that of plain Bun.
import { createRequire } from "node:module";
import "node:path";

function report(label, load) {
  try {
    console.log(label, typeof load());
  } catch (error) {
    console.log(label, error.code);
  }
}

let stored = createRequire(import.meta.url);
report("stored before", () => stored("node:path"));
stored = name => "mine " + name;
report("stored after", () => stored("node:dgram"));

{
  const createRequire = url => name => [url.length > 0, name];
  const own = createRequire(import.meta.url);
  report("own", () => own("node:dgram"));
}

const elsewhere = createRequire(process.cwd() + "/");
report("elsewhere in", () => elsewhere("node:path"));
report("elsewhere out", () => elsewhere("node:dgram"));
