// Functions with much control flow and many values alive at once: what a code generator has to keep apart in registers and frame slots, across joins, loops, handlers and calls.
//
//   values    4 to 1,300 variables a function, each of one kind for good: int32, double, boolean, string, an object of a class, or anything in turn
//   flow      if, for, while with break and continue, do, switch that falls through, labelled blocks and loops, try with catch and finally, an early return, ?: && || ??
//   calls     functions the compiler cannot look through, one for each kind; closures that write variables of the function they were made in
//   waits     one function in three is a generator or an async function: all its variables live across every yield and await
//
// Every function is called some hundred times with other arguments, and all its variables go into one number at the end. One line a function.
// Always TypeScript: the mode `erased` gives the untyped form.
import type { Random } from "./random";

type Kind = "int" | "double" | "flag" | "text" | "box" | "any";

const prelude = `class Box {
  constructor(
    public n: number,
    public next: Box | null,
  ) {}
}
let calls = 0;
function tick(): void {
  if (++calls % 977 === 0)
    try {
      throw calls;
    } catch {}
}
function opaqueInt(x: number, y: number): number {
  tick();
  return (x * 3 - y) | 0;
}
function opaqueDouble(x: number, y: number): number {
  tick();
  return x * 0.75 + y;
}
function opaqueText(x: string, y: number): string {
  tick();
  return (x + (y & 7)).slice(-5);
}
function opaqueBox(x: Box, y: number): Box {
  tick();
  return y & 1 ? x : new Box(y | 0, null);
}
async function opaqueLater(x: number): Promise<number> {
  tick();
  return (x + 1) | 0;
}
function opaqueAny(x: any): any {
  tick();
  return x;
}
function drained(steps: Generator<number, number, number>): number {
  let sum = 0;
  for (let step = steps.next(0); ; step = steps.next(sum & 7)) {
    sum = (Math.imul(sum, 31) + step.value) | 0;
    if (step.done) return sum;
  }
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? 13 : value !== value ? 17 : (value * 1000) | 0;
    case "boolean":
      return value ? 3 : 5;
    case "string":
      return value.length * 31 + (value.charCodeAt(0) | 0);
    case "undefined":
      return 7;
    default:
      return value === null ? 11 : value.n | 0;
  }
}
`;

export function generate(random: Random): string {
  const below = (limit: number) => random.below(limit);
  const text: string[] = [prelude];
  const notes: string[] = [];
  const functions = random.between(2, 6);

  for (let number = 0; number < functions; number++) {
    // prettier-ignore
    const [count, depth, size] = random.weighted([[4, [4, 3, 40]], [4, [8, 4, 80]], [4, [16, 5, 160]], [3, [40, 5, 300]], [2, [120, 4, 300]], [1, [400, 3, 200]], [1, [1300, 2, 60]]] as const);
    const mix = random.pick<readonly (readonly [number, Kind])[]>([
      [[1, "int"]],
      [[3, "int"], [2, "double"]],
      [[3, "int"], [2, "double"], [1, "flag"], [2, "text"], [2, "box"], [1, "any"]],
      [[1, "int"], [1, "double"], [1, "flag"], [1, "text"], [1, "box"], [2, "any"]],
      [[1, "int"], [3, "box"], [2, "any"]],
    ]); // prettier-ignore
    const kinds: Kind[] = Array.from({ length: count }, (_, index) => (index < 2 ? "int" : random.weighted(mix)));
    const of = (kind: Kind) => {
      const all = kinds.flatMap((each, index) => (each === kind ? [index] : []));
      return all.length ? "v" + all[below(all.length)] : undefined;
    };
    const int = () => of("int")!;
    const form = count > 400 ? "plain" : random.weighted([[4, "plain"], [1, "generator"], [1, "async"]] as const);
    let budget = size;
    let names = 0;
    const closures: string[] = [];

    const value = (kind: Kind): string => {
      const [a, b] = [int(), int()];
      const [d, t, o, m, f] = [of("double") ?? a, of("text") ?? '"t"', of("box") ?? "spare", of("any") ?? a, of("flag") ?? `(${a} > 0)`];
      // prettier-ignore
      switch (kind) {
        case "int":
          return random.pick([`(${a} + ${b}) | 0`, `(${a} - ${b}) | 0`, `Math.imul(${a}, ${b})`, `${a} ^ ${b}`, `(${a} >> (${b} & 7)) | 0`, `(${a} * 0.5 + ${b}) | 0`, `(${a} & ${b}) | 1`, `${a} > ${b} ? ${a} : ${b}`, `(${a} + ${below(100)}) | 0`,
            `(${d} * 3) | 0`, `${t}.length`, `${o}.n | 0`, `fold(${m})`, `${f} ? ${a} : ${b}`, `opaqueInt(${a}, ${b})`, `(${a} >>> 3) & 1023`, `(${a} % ((${b} & 15) + 1)) | 0`, ...closures.map(name => `${name}(${a})`)]);
        case "double":
          return random.pick([`${d} * 0.5 + ${a}`, `${d} - ${b} * 0.25`, `${a} / ((${b} & 7) + 1)`, `Math.sqrt(Math.abs(${d}))`, `${d} > 1e6 || ${d} < -1e6 ? 0.5 : ${d} * 1.5`, `opaqueDouble(${d}, ${a})`, `${f} ? ${d} : ${a} + 0.5`, `Math.floor(${d}) + 0.25`, `-${d}`,
            `${a} & 1 ? NaN : ${d}`, `${a} & 3 ? ${d} : -0`, `${d} * 0`, `(${a} & 7) / (${b} & 1)`, `${d} !== ${d} ? ${a} : ${d}`]);
        case "flag":
          return random.pick([`${a} < ${b}`, `!${f}`, `${f} && ${a} > 3`, `${f} || ${d} < 0`, `${t} < "m"`, `${o}.next === null`, `${m} === undefined`, `${a} === ${b}`]);
        case "text":
          return random.pick([`(${t} + "a").slice(-6)`, `String(${a} & 15)`, `(${t} + ${t}.length).slice(-4)`, `opaqueText(${t}, ${a})`, `${f} ? ${t} : "z"`, `${t}.slice(1) + "q"`, `\`\${${a} & 3}\${${t}.slice(0, 3)}\``]);
        case "box":
          return random.pick([`new Box(${a}, null)`, `new Box(${a}, ${o}.next === null ? ${o} : null)`, `${o}.next ?? ${o}`, `opaqueBox(${o}, ${a})`, `${f} ? ${o} : spare`, o]);
        default:
          return random.pick([a, d, t, o, f, "undefined", "null", `opaqueAny(${m})`, `${f} ? ${a} : ${t}`, `${m} ?? ${o}`, `typeof ${m} === "number" ? ${m} + 1 : ${a}`]);
      }
    };
    const assign = () => {
      const index = below(count);
      const o = of("box");
      return o && !below(12) ? `${o}.n = ${value("int")};` : `v${index} = ${value(kinds[index])};`;
    };
    const condition = () => {
      const [a, b] = [int(), int()];
      // prettier-ignore
      return random.pick([`${a} ${random.pick(["<", ">", "<=", "!==", "==="])} ${below(3) ? b : below(50)}`, `${a} ${random.pick(["<", ">"])} ${b}`, of("flag") ?? `${a} & 1`, `${of("double") ?? a} < ${b}`, `${of("text") ?? '"k"'} < "k"`,
        `${of("box") ?? "spare"}.n > ${b}`, of("any") ? `typeof ${of("any")} === "${random.pick(["number", "string", "object", "undefined"])}"` : `${a} & 2`, `${a} > ${b} && ${b} > ${below(20)}`, `${a} < 0 || ${b} < 0`]);
    };
    // `turns`: how often the place runs in one call at most. Loops in loops multiply.
    const statements = (left: number, loops: string[], turns: number): string => {
      let all = "";
      for (let more = 1 + below(4); more-- && budget > 0; ) {
        budget--;
        const inner = () => statements(left - 1, loops, turns);
        const drawn = left > 0 ? below(20) : below(4);
        switch ([6, 7, 12, 14].includes(drawn) && turns > 40 ? 0 : drawn) {
          case 0: case 1: case 2: case 3: all += assign(); break; // prettier-ignore
          case 4: case 5: all += `if (${condition()}) {${inner()}} else {${inner()}}`; break; // prettier-ignore
          case 6: {
            const [counter, label] = ["c" + names, "L" + names++];
            all += `${label}: for (let ${counter} = 0; ${counter} < ${1 + below(5)}; ${counter}++) {${statements(left - 1, [...loops, label], turns * 5)}}`;
            break;
          }
          case 7: {
            const [counter, label] = ["c" + names, "L" + names++];
            all += `let ${counter} = ${1 + below(4)}; ${label}: while (${counter}-- > 0) {${statements(left - 1, [...loops, label], turns * 4)} if (${condition()}) ${below(2) ? "break" : "continue"};}`;
            break;
          }
          case 8: all += `switch (${int()} & 3) { case 0: ${inner()} break; case 1: ${inner()} case 2: ${inner()} break; default: ${inner()} }`; break; // prettier-ignore
          case 9: all += `try {${inner()} if (${condition()}) throw ${int()};${inner()}} catch (thrown) {${int()} = ((thrown as number) | 0) + 1;${assign()}} finally {${assign()}}`; break; // prettier-ignore
          case 10: all += `try {${inner()}} finally {${assign()}}`; break; // prettier-ignore
          case 11: {
            const label = "L" + names++;
            all += `${label}: {${inner()} if (${condition()}) break ${label};${inner()}}`;
            break;
          }
          case 12: {
            const counter = "c" + names++;
            all += `let ${counter} = ${1 + below(3)}; do {${statements(left - 1, loops, turns * 3)}} while (--${counter} > 0 && (${condition()}));`;
            break;
          }
          case 13: all += loops.length ? `if (${condition()}) ${below(2) ? "break" : "continue"} ${random.pick(loops)};` : assign(); break; // prettier-ignore
          case 14: all += `for (const each of [${int()}, ${int()}, ${below(9)}]) {${int()} = (${int()} + each) | 0;${statements(left - 1, loops, turns * 3)}}`; break; // prettier-ignore
          case 15: all += !below(6) ? `if (${condition()} && ${condition()}) return ${int()};` : assign(); break; // prettier-ignore
          case 16: all += `${int()} = ${condition()} ? ${value("int")} : ${value("int")};`; break; // prettier-ignore
          case 17: all += `try {${inner()}} finally { switch (${int()} & 3) { case 0: ${assign()} break; case 1: ${assign()} case 2: ${assign()} break; default: ${assign()} } }`; break; // prettier-ignore
          default:
            all += form === "generator" ? random.pick([`yield ${int()};`, `${int()} = ((yield ${int()}) + ${int()}) | 0;`]) : form === "async" ? random.pick([`${int()} = await opaqueLater(${int()});`, `await null;`, `${int()} = (${int()} + (await ${int()})) | 0;`]) : assign();
        }
      }
      return all;
    };

    // prettier-ignore
    const first: Record<Kind, (index: number) => string> = {
      int: index => `(a * ${index + 1} + b * ${below(9)} + ${below(50)}) | 0`, double: index => `a * ${index}.5 + b / 4`, flag: index => `((a + ${index}) & 1) === 0`, text: index => `String((a + ${index}) & 31)`,
      box: index => `new Box(b + ${index}, null)`, any: index => random.pick([`a + ${index}`, `String(b)`, "undefined", `new Box(a, null)`, `a * 0.5`, "null"]),
    };
    const types: Record<Kind, string> = { int: "number", double: "number", flag: "boolean", text: "string", box: "Box", any: "any" };
    let body = "const spare = new Box(a, null);";
    kinds.forEach((kind, index) => (body += `let v${index}: ${types[kind]} = ${first[kind](index)};`));
    for (let made = below(3); made--; ) {
      const [name, written] = ["closure" + closures.length, int()];
      body += `const ${name} = (x: number): number => { ${written} = (${written} + x) | 0; return ${written} ^ ${int()}; };`;
      closures.push(name);
    }
    body += statements(depth, [], 1);
    body += `return (${kinds.map((kind, index) => (kind === "int" ? "v" + index : `fold(v${index})`)).join(" ^ ")}) | 0;`;
    const rounds = random.pick(form === "plain" ? [20, 100, 400] : [20, 100]);
    notes.push(`${form === "plain" ? "" : form + " "}${count} of ${[...new Set(kinds)].join("+")}`);
    const head = { plain: "function", generator: "function*", async: "async function" }[form];
    const result = { plain: "number", generator: "Generator<number, number, number>", async: "Promise<number>" }[form];
    const call = `f${number}(i, (i * 7) & 63)`;
    const answer = { plain: call, generator: `drained(${call})`, async: `(await ${call})` }[form];
    text.push(`${head} f${number}(a: number, b: number): ${result} {\n${body.replace(/([;{}])(?=[^\n])/g, "$1\n")}\n}
{
  let hash = 0;
  for (let i = 0; i < ${rounds}; i++) hash = (Math.imul(hash, 31) + ${answer}) | 0;
  console.log("f${number} " + (hash >>> 0).toString(16));
}
`);
  }
  return `// ${notes.join(" . ")}\n${text.join("\n")}`;
}
