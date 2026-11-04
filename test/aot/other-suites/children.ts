// Writes the second column of bun-tests.same.txt, what the tests of a file start: `bun test/aot/other-suites/children.ts`
//   none      no Bun: every test runs in the compiled file itself
//   plain     Bun, on small programs or projects, and those runs are plain: "the same both ways" is about the code round them alone
//   compiled  ../runner-suites holds the file too, and there what it starts runs compiled
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const root = join(here, "..", "..", "..");
const suites = join(here, "..", "runner-suites");
const holders = [join(here, "..", "runner-suites.test.ts"), ...readdirSync(suites).map(name => join(suites, name))];
const held = new Set(
  holders.flatMap(file => [...readFileSync(file, "utf8").matchAll(/"(test\/[^" ]+)/g)].map(match => match[1])),
);
const startsBun = /bunExe\(\)|process\.execPath|\bbunRun\w*\(|\brunBun\w*\(/;

const list = join(here, "bun-tests.same.txt");
const lines = readFileSync(list, "utf8")
  .split("\n")
  .filter(line => line);
const marked = lines.map(line => {
  const [file] = line.split("\t");
  const children = held.has(file)
    ? "compiled"
    : startsBun.test(readFileSync(join(root, file), "utf8"))
      ? "plain"
      : "none";
  return `${file}\t${children}`;
});
writeFileSync(list, marked.join("\n") + "\n");
for (const kind of ["none", "plain", "compiled"])
  console.log(kind, marked.filter(line => line.endsWith("\t" + kind)).length);
