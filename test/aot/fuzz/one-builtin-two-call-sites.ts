// One built-in is called at two unrelated call sites. The first inspects the result closely: its identity, the names of
// functions in it, its key order, what a store through it changes. The second passes it on or ignores it.
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  // Each built-in: how it is called with `S` as its subject, the type of the result, and the subject at each site.
  const asked = random.pick<
    [string, "descriptors" | "descriptor" | "pairs" | "list" | "object" | "value", string, string]
  >([
    ["Object.getOwnPropertyDescriptors(S)", "descriptors", "object", "object"],
    ["Object.getOwnPropertyDescriptors(S)", "descriptors", "object", "instance"],
    ["Object.getOwnPropertyDescriptors(S)", "descriptors", "instance", "object"],
    ['Object.getOwnPropertyDescriptor(S, "f")', "descriptor", "object", "instance"],
    ["Object.entries(S)", "pairs", "object", "instance"],
    ["Object.entries(S)", "pairs", "instance", "object"],
    ["Object.values(S)", "list", "object", "instance"],
    ["Object.values(S)", "list", "instance", "object"],
    ["Object.assign({}, S)", "object", "object", "instance"],
    ["{ ...S }", "object", "object", "instance"],
    ["{ ...S }", "object", "instance", "object"],
    ["Object.fromEntries(Object.entries(S))", "object", "object", "instance"],
    ["Object.create(S)", "object", "object", "instance"],
    ["Object.freeze(S)", "object", "object", "instance"],
    ["Array.from(Object.values(S))", "list", "object", "instance"],
    ["Object.values(S).slice()", "list", "object", "instance"],
    ["Object.values(S).map(each => each)", "list", "object", "instance"],
    ["Object.values(S).filter(() => true)", "list", "object", "instance"],
    ["[].concat(Object.values(S))", "list", "object", "instance"],
    ['Object.values(S).find(each => typeof each === "function")', "value", "object", "instance"],
    ["Object.values(S).at(-1)", "value", "object", "instance"],
    ['Reflect.get(S, "f")', "value", "object", "instance"],
    ['new Map(Object.entries(S)).get("f")', "value", "object", "instance"],
    ["S.f.bind(S)", "value", "object", "instance"],
    ["(await Promise.resolve(S))", "object", "object", "instance"],
    ["[S][0]", "object", "object", "instance"],
    ["(x => x)(S)", "object", "object", "instance"],
  ]);
  const [ask, kind, firstSubject, secondSubject] = asked;
  const subject = (which: string, n: number) =>
    which === "object"
      ? `{\nn: ${n},\nf() {\nreturn new Error("x").stack;\n},\n}`
      : random.pick([`new Held(${n})`, `new Held(${n})`, `new Fields(${n})`]);
  // The function that the first site takes from the result.
  const taken = {
    descriptors: "answer.f.value",
    descriptor: "answer.value",
    pairs: 'answer.find(([name]) => name === "f")[1]',
    list: 'answer.find(each => typeof each === "function")',
    object: "answer.f",
    value: "answer",
  }[kind];
  const closely = random.pick([
    `const g = ${taken};\nconsole.log(typeof g, g.name, g.length, g === subject.f);`,
    `const g = ${taken};\nconsole.log(top(g.call(subject)));`,
    `const g = rename(${taken}, name);\nconsole.log(g.name, top(g.call(subject)));`,
    `const g = rename(${taken}, name);\nconsole.log(g.name, top(g.call(subject)));`,
    `const g = ${taken};\ng.tag = name;\nconsole.log(g.tag, subject.f.tag);`,
    kind === "value"
      ? `console.log(typeof answer, answer === subject.f);`
      : `console.log(Reflect.ownKeys(answer).map(String).join(), answer === subject);`,
    kind === "value"
      ? `console.log(String(answer.name), answer.length);`
      : `console.log(JSON.stringify(answer), Object.isFrozen(answer), Object.getPrototypeOf(answer) === Object.getPrototypeOf(subject));`,
    kind === "object"
      ? `try {\nanswer.n = 9;\n} catch {}\nconsole.log(answer.n, subject.n);`
      : `console.log(typeof (${taken}), (${taken}) === (${taken}));`,
  ]);
  const apart = random.pick([
    `console.log(\nObject.entries(other)\n.map(([name, each]) => name + typeof each + typeof each?.value)\n.join(),\n);`,
    `console.log(\nObject.entries(other)\n.map(([name, each]) => name + typeof each + typeof each?.value)\n.join(),\n);`,
    `console.log(JSON.stringify(other));`,
    `for (const name in other) sink.push(other[name]);\nconsole.log(sink.length);`,
    `globalThis.kept = other;\nconsole.log(typeof globalThis.kept);`,
    `for (const each of Object.values(Object(other))) {\nif (Object(each) === each && Object.isExtensible(each)) each.tag = 1;\n}\nconsole.log("tagged");`,
    `try {\nother[key("added")] = 0;\n} catch {}\nconsole.log(Reflect.ownKeys(Object(other)).length);`,
    `try {\ndelete other[key("f")];\n} catch {}\nconsole.log(Reflect.ownKeys(Object(other)).length);`,
    `try {\nObject.defineProperty(other, key("f"), { value: 1, configurable: true });\n} catch {}\nconsole.log(typeof other[key("f")]);`,
    `try {\nObject.setPrototypeOf(other, null);\n} catch {}\nconsole.log(Object.getPrototypeOf(Object(other)) === null);`,
    `console.log(typeof new Proxy(Object(other), {})[key("f")]);`,
    `console.log(typeof hidden(other));`,
    `sink.push(...Object.values(Object(other)));\nconsole.log(sink.length);`,
    `for (const each of Object.values(Object(other))) {\nif (typeof each === "function") rename(each, "other");\nif (typeof each?.value === "function") rename(each.value, "other");\n}\nconsole.log("renamed");`,
  ]);
  const waits = ask.includes("await");
  const A = waits ? "async " : "";
  const W = waits ? "await " : "";
  const first = `${A}function first(name) {\nconst subject = ${subject(firstSubject, 1)};\nconst answer = ${ask.replaceAll("S", "subject")};\n${closely}\n}`;
  const second = `${A}function second() {\nconst given = ${subject(secondSubject, 2)};\nconst other = ${ask.replaceAll("S", "given")};\n${apart}\n}`;
  const order = random.pick([
    [`${W}first("a1");`, `${W}second();`],
    [`${W}second();`, `${W}first("a1");`],
    [`${W}first("a1");`, `${W}second();`, `${W}first("b1");`],
    [`${W}first("a1");`, `${W}first("b1");`, `if (process.argv.length > 99) ${W}second();`],
    [`if (process.argv.length > 99) ${W}second();`, `${W}first("a1");`, `${W}first("b1");`],
    [`${W}first("a1");`, `${W}first("b1");`, `${W}second();`, `${W}first("a1");`],
  ]);
  const all = first + second;
  const head = [
    all.includes("top(")
      ? 'const top = stack =>\nString(stack)\n.split("\\n")\n.filter(line => line.trimStart().startsWith("at "))\n.slice(0, 1)\n.map(line => line.trim().replace(/ ?\\(?[^ (]*:\\d+:\\d+\\)?$/, ""))\n.join();'
      : "",
    all.includes("rename(") ? 'const rename = (f, n) => Object.defineProperty(f, "name", { value: n });' : "",
    all.includes("key(") ? 'const key = name => (process.argv.length > 99 ? "none" : name);' : "",
    all.includes("sink") ? "const sink = [];" : "",
    all.includes("hidden(") ? "const hidden = [x => x, x => [x]][process.argv.length > 99 ? 1 : 0];" : "",
    all.includes("new Held")
      ? 'class Held {\nconstructor(n) {\nthis.n = n;\nthis.f = function () {\nreturn new Error("x").stack;\n};\n}\n}'
      : "",
    all.includes("new Fields")
      ? 'class Fields {\nn;\nf = () => new Error("x").stack;\nconstructor(n) {\nthis.n = n;\n}\n}'
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const places = random.chance(0.5) ? [first, second] : [second, first];
  const file = waits || random.chance(0.5) ? "main.mjs" : "main.cjs";
  return { file, text: `${head}\n${places.join("\n")}\n${order.join("\n")}\n` };
}
