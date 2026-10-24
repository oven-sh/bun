// ./everyday/<group>.txt holds many small idioms, one under each line `//// <name>`: TypeScript that declares `function turn(i: number): number`, or the same
// function async. everydayIdioms() puts each into a program of the form of ./idioms: a loop that calls turn() as often as ./idioms/host.ts says.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const root = join(import.meta.dir, "everyday");

function program(text: string) {
  const isAsync = /^async function turn\b/m.test(text);
  return `import { nextTurns } from "../host.ts";
${text.trim()}
${isAsync ? "async function bench(n: number)" : "function bench(n: number): number"} {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + ${isAsync ? "(await turn(i))" : "turn(i)"}) | 0;
  return sum;
}
let answer = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(answer)) answer = (answer + ${isAsync ? "(await bench(n))" : "bench(n)"}) & 0xffffff;
console.log(answer);
`;
}

export function everydayIdioms() {
  const idioms: { name: string; text: string }[] = [];
  for (const file of readdirSync(root).sort()) {
    const [, ...sections] = readFileSync(join(root, file), "utf8").split(/^\/\/\/\/ /m);
    for (const section of sections) {
      const end = section.indexOf("\n");
      idioms.push({ name: `everyday-${file.slice(0, -4)}/${section.slice(0, end).trim()}`, text: program(section.slice(end + 1)) });
    }
  }
  return idioms;
}

/** Beside the idioms that writeUntypedIdioms() has put into `where`: each as TypeScript and as the same text without its types. */
export function writeEverydayIdioms(where: string) {
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: false, inline: false });
  const idioms = everydayIdioms();
  for (const { name, text } of idioms) {
    mkdirSync(dirname(join(where, name)), { recursive: true });
    writeFileSync(join(where, name + ".ts"), text);
    writeFileSync(join(where, name + ".js"), transpiler.transformSync(text));
  }
  return idioms.map(idiom => idiom.name);
}
