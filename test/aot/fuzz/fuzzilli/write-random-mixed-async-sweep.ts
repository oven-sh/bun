// Async functions, generators and methods of statements of all kinds: values of every kind awaited, loops, handlers, closures, several workers at once. Each program waits for all it starts.
//
//   bun write-random-mixed-async-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<seed>-<workers>-<statements>.mjs or .ts
import { mkdirSync, writeFileSync } from "node:fs";

// `V` is a value that is awaited, `W` a worker that is called, `i` counts.
const values = [
  "i", "null", "undefined", "i + 0.5", "'s' + i", "true", "1n", "{ v: i }", "[i, 2]", "Symbol.iterator", "NaN", "-0", "(() => i)",
  "Promise.resolve(i)", "Promise.resolve(null)", "Promise.resolve(Promise.resolve(i))", "kept", "late(i)", "late(null)", "now(i)", "thenable(i)", "W(i & 1)",
  "Promise.all([i, late(i), null])", "Promise.race([late(1), i])", "Promise.allSettled([fails(i), i]).then(all => all.length)", "Promise.any([fails(1), late(i)])",
  "new Promise(done => done(i))", "new Promise(done => queueMicrotask(() => done(i)))", "box.step(i)", "box.late(i)", "new Own(done => done(i))", "Own.resolve(i)", "any",
  "gather(count(i & 3))", "late(i).then(value => value + 1)", "fails(i).catch(error => error.message)", "late(i).finally(() => tell('f'))",
]; // prettier-ignore
const statements = [
  "any = await V;",
  "tell(show(await V));",
  "sum += +(await V) || 1;",
  "await V;",
  "await null;",
  "await undefined;",
  "any = [await V, await V];",
  "any = { a: await V, b: any };",
  "tell(`${show(await V)}${i}`);",
  "any = (await V) ?? i;",
  "any = (await V) || (await V);",
  "any = (await V) ? 1 : await V;",
  "const { v = 3 } = Object((await V) ?? {});\nsum += +v || 0;",
  "const [first = 2] = [await V];\ntell(show(first));",
  "any = await (async () => V)();",
  "any = await (async () => {\n  await V;\n  sum++;\n  return V;\n})();",
  "const part = async value => {\n  any = await value;\n  return value;\n};\ntell(show(await part(V)));",
  "any = await Promise.all([1, 2].map(async value => {\n  await V;\n  return value + i;\n}));",
  "list.push(await V);",
  "list = list.slice(-4);",
  "sum = (sum * 3 + list.length) | 0;",
  "any = list[i & 3];",
  "tell(i);",
  "tell(show(any));",
  "state.v = await V;",
  "state.v += await late(i);",
  "state[await late('v')] = i;",
  "any = twice(await V);",
  "any = await W(i & 1);",
  "pending.push(W(0));",
  "pending.push(late(i));",
  "await Promise.all(pending);\npending.length = 0;",
  "queueMicrotask(() => tell('m' + i));",
  "kept = late(i);",
  "kept = Promise.resolve(i);",
  "for await (const item of count(i & 3)) tell(item);",
  "for await (const item of [late(1), 2, null]) sum += +item;",
  "for (const item of plain(3)) sum += item;",
  "any = (await count(2).next()).value;",
  "const steps = count(3);\nawait steps.next();\ntell(show((await steps.return(i)).value));",
  "any = await box.step(i);",
  "box.v = await V;",
  "any = await box.late?.(i);",
  "any = typeof (await V);",
  "any = void (await V);",
  "sum -= await late(1);",
  "const own = i;\nconst read = async () => own + sum;\nawait null;\nsum += await read();",
];
const nests = [
  "for (let j = 0; j < 3; j++) {\n  S\n}",
  "for (const item of list.slice(0, 3)) {\n  any = item;\n  S\n}",
  "if (i & 1) {\n  S\n} else {\n  S\n}",
  "if (await late(i & 1)) {\n  S\n}",
  "try {\n  S\n  if (i === 1) throw new RangeError('t');\n} catch (error) {\n  tell(error.name);\n  S\n}",
  "try {\n  await fails(i);\n  S\n} catch (error) {\n  tell(error.message);\n}",
  "try {\n  S\n} finally {\n  sum = sum | 0;\n  S\n}",
  "switch (await late(i & 1)) {\n  case 0:\n    S\n    break;\n  default:\n    S\n}",
  "let left = 2;\nwhile (left-- > 0) {\n  S\n}",
  "let more = 0;\ndo {\n  S\n} while ((await late(++more)) < 2);",
  "const part = async () => {\n  S\n};\nawait part();",
  "const part = async () => {\n  S\n};\nawait Promise.all([part(), part()]);",
  "const part = async () => {\n  try {\n    S\n    return i;\n  } finally {\n    S\n  }\n};\ntell(show(await part()));",
  "outer: for (let j = 0; j < 3; j++) {\n  for (const item of [1, 2]) {\n    if (sum & 1) continue outer;\n    S\n    if (j) break outer;\n  }\n}",
  "for await (const item of count(2)) {\n  S\n  if (item) break;\n}",
];

function write(seed: number): { name: string; text: string } {
  let state = (seed * 2654435761 + 4242) >>> 0 || 1;
  const random = (below: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % below;
  };
  for (let turn = 0; turn < 8; turn++) random(2);
  const pick = <T>(from: readonly T[]): T => from[random(from.length)];
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const workers = 1 + random(4);
  let count = 0;
  let worker = 0;
  // A worker calls those before it alone.
  const fill = (text: string) => text.replaceAll(/\b[VW]\b/g, letter => (letter === "V" ? pick(values).replaceAll(/\bW\b/g, () => (worker ? `work${random(worker)}` : "late")) : worker ? `work${random(worker)}` : "late")); // prettier-ignore
  const draw = (depth: number, most: number): string => {
    const parts: string[] = [];
    for (let at = 1 + random(most); at > 0; at--) {
      count++;
      if (depth < 2 && random(4) === 0)
        parts.push(`{\n${indent(fill(pick(nests).replaceAll("outer", `outer${count}`)).replaceAll(/^( *)S$/gm, (_, by) => indent(draw(depth + 1, 3), by)), "  ")}\n}`); // prettier-ignore
      else {
        const text = fill(pick(statements));
        parts.push(/^const /m.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
      }
    }
    return parts.join("\n");
  };
  const isTyped = seed % 4 === 1;
  const bodies: string[] = [];
  for (worker = 0; worker < workers; worker++) {
    const loop = pick(["for (let i = n; i < n + 3; i++) {\n  S\n}", "const i = n;\nS", "for (const i of [0, 1, 2]) {\n  S\n}", "let i = n;\nwhile (i < 3) {\n  S\n  i++;\n}"]); // prettier-ignore
    const body = loop.replaceAll(/^( *)S$/gm, (_, by) => indent(draw(0, 6), by));
    const head = pick([`async function work${worker}(n) {`, `const work${worker} = async n => {`, `const work${worker} = async function (n = 1) {`]); // prettier-ignore
    bodies.push(
      [
        head,
        "  let sum = 0;",
        "  let any;",
        "  let list = [1, null];",
        "  const pending = [];",
        "  const state = { v: 1 };",
        indent(body, "  "),
        "  await Promise.allSettled(pending);",
        "  tell(show(sum) + show(any) + show(list) + show(state));",
        "  return any;",
        `}${head.startsWith("const") ? ";" : ""}`,
      ].join("\n"),
    );
  }
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (typeof value === "function" ? "f" : Array.isArray(value) ? "[" + value.slice(0, 6).map(show) + "]" : typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? "(" + Object.keys(value).map(name => name + ":" + typeof value[name]) + ")" : Object.is(value, -0) ? "-0" : String(value).slice(0, 24));',
    "const out = [];",
    "const tell = text => void (out.length < 400 && out.push(text));",
    "const late = async value => {\n  await null;\n  return value;\n};",
    "const now = async value => value;",
    "const fails = async value => {\n  await undefined;\n  throw new Error('e' + value);\n};",
    "const thenable = value => ({\n  then(done) {\n    done(value);\n  },\n});",
    "const twice = value => value * 2;",
    "class Own extends Promise {}",
    "async function* count(n) {\n  for (let at = 0; at < n; at++) {\n    await null;\n    yield at;\n  }\n}",
    "function* plain(n) {\n  for (let at = 0; at < n; at++) yield at;\n}",
    "async function gather(from) {\n  const all = [];\n  for await (const item of from) all.push(item);\n  return all;\n}",
    "class Box {\n  v = 1;\n  async step(value) {\n    this.v += await late(1);\n    return this.v + value;\n  }\n}\nclass Wide extends Box {\n  async step(value) {\n    const below = await super.step(value);\n    return below + 1;\n  }\n  async late(value) {\n    await null;\n    return [this.v, value];\n  }\n}",
    `const box = new ${seed % 3 ? "Wide" : "Box"}();`,
    ...(seed % 3 ? [] : ["box.late = async value => value;"]),
    "let kept = Promise.resolve(7);",
    ...bodies,
    "for (const n of [0, 2]) {",
    "  try {",
    seed % 2 ? `    tell(show(await work${workers - 1}(n)));` : `    tell(show((await Promise.allSettled([${bodies.map((_, at) => `work${at}(n)`).join(", ")}])).map(one => one.status[0] + show(one.value))));`, // prettier-ignore
    "  } catch (error) {",
    "    tell(error.name);",
    "  }",
    "}",
    "await new Promise(done => setTimeout(done, 1));",
    'console.log(out.join(" ").slice(0, 2500));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return { name: `${workers}-${count}.${isTyped ? "ts" : "mjs"}`, text: lines.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 100), Number(process.argv[5] ?? 1)]; // prettier-ignore
mkdirSync(folder, { recursive: true });
for (let step = 0; step < count; step++) {
  const seed = from + step * stride;
  const program = write(seed);
  writeFileSync(`${folder}/${padNumber(seed)}-${program.name}`, program.text);
}
console.log(count);
