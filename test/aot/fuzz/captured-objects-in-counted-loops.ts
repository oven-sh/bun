// The programs of captured-numbers-in-counted-loops, with an object in each of the six variables: `{ v: number }`. A read goes through
// `.v`; a store changes the object's field or puts a fresh object into the variable; a swap exchanges the numbers or the objects
// themselves; one variable may live in a static field of a class. Closures and counted loops work on these variables as they did on the
// numbers. A compiler that tests the kind of a loop-carried variable once, in front of the loop, can meet a variable that holds nothing
// yet: for a number that test is merely early, but what stands for "nothing" can pass for an object, and then its header is read.
// Half of the static fields are deleted while a Proxy stands above their class and defined anew through its trap, before any function
// runs: a compiler that keeps a static field in a variable of its own cannot keep this one there, and that variable holds nothing.
// Such a class has fields beside that one, the trap counts its calls, and the function also knows the class under a second name, which
// it got from a call: in each turn of its loop it may halve the field's number and writes down what it reads under that name.
import { generate as generateNumbers } from "./captured-numbers-in-counted-loops";
import type { Random } from "./random";

export function generate(random: Random, typed: boolean): string {
  const box = typed ? ": Box" : "";
  const classes: string[] = [];
  const text = generateNumbers(random, typed).replace(/^function (k\d+)\([^\n]*\n([\s\S]*?)\n}$/gm, (whole, name: string) => {
    const [head, ...lines] = whole.split("\n");
    const holder = random.chance(0.3) ? `S${name}` : "";
    const body = lines
      .map(line => {
        // The declaration of the six: each starts as a fresh object.
        const declared = /^(\s*)let (a(?:: number)? = .*);$/.exec(line);
        if (declared)
          return `${declared[1]}let ${declared[2]
            .split(", ")
            .map(each => each.replace(/^([a-f])(?:: number)? = (.*)$/, (_, variable, value) => `${variable}${box} = { v: ${value} }`))
            .join(", ")};`;
        let changed = line.replace(/(?<![.\w$"])([a-f])(?![\w$":])/g, "$1.v");
        // Half of the swaps exchange the objects.
        changed = changed.replace(/const t = ([a-f])\.v; \1\.v = ([a-f])\.v; \2\.v = t;/g, (found, v, w) =>
          random.chance(0.5) ? `const t = ${v}; ${v} = ${w}; ${w} = t;` : found,
        );
        // Half of the plain stores put a fresh object into the variable. A store in brackets is an expression, whose value is the number.
        return changed.replace(/(?<![.\w$(])([a-f])\.v = ([^;=][^;]*);/g, (found, v, value) =>
          random.chance(0.5) ? `${v} = { v: ${value} };` : found,
        );
      })
      .join("\n");
    if (!holder) return `${head}\n${body}`;
    // The variable f lives in a static field, which every call sets anew.
    classes.push(`class ${holder} { static a = 7; static f${box} = { v: 0 }; static b = 9; }${random.chance(0.5) ? `\nleave(${holder});` : ""}`);
    const halves = random.chance(0.6) ? `${holder}.f = { v: ${holder}.f.v / 2 }; ` : "";
    return `${head}\n${body
      .replace(/, f(?:: Box)? = (\{ v: [^}]*\});/, `; ${holder}.f = $1; const held = keep(${holder}); const seen${typed ? ": number[]" : ""} = [];`)
      .replace(/(?<![.\w$"])f(?![\w$":])/g, `${holder}.f`)
      .replace(/^(  for \(let i0 = [^\n]*\{)$/m, `$1\n    ${halves}seen.push(held.f.v);`)
      .replace(/^  return (?!\{)(.*);$/m, `  return $1 + "|" + seen.map(show).join();`)}`;
  });
  const helpers = `let current${typed ? ": unknown" : ""};
let trapped = 0;
function keep${typed ? "<T>" : ""}(holder${typed ? ": T" : ""})${typed ? ": T" : ""} { current = holder; return holder; }
function leave(holder${typed ? ": any" : ""})${typed ? ": void" : ""} {
  Object.setPrototypeOf(holder, new Proxy({}, { set(target, name, value, receiver) { trapped++; return Reflect.set(target, name, value, receiver); } }));
  delete holder.f;
  holder.f = { v: 0 };
}
`;
  return `${typed ? "type Box = { v: number };\n" : ""}${classes.length ? helpers + classes.join("\n") + "\n" : ""}${text.replace(/(export \{\};\n)?$/, `${classes.length ? 'console.log("trapped", trapped, typeof current);\n' : ""}$1`)}`;
}
