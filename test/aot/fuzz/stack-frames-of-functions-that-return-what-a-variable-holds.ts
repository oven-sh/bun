// A chain of functions, each of which calls the next one, keeps the result in a variable and returns it in one of many ways: at once, through a
// second variable, out of a block, a loop, a switch, a try, a conditional, beside other variables, with and without a declared type. The last
// function of the chain writes down the names of the functions on the stack. Which of them are still there depends on which calls stand in
// tail position once a variable that is named once has been replaced by its initializer.
import type { Random } from "./random";

type Shape = (next: string, typed: boolean) => string;

const annotate = (typed: boolean, type = "unknown") => (typed ? `: ${type}` : "");

export const bodies: readonly Shape[] = [
  next => `const r = ${next}(x);\nreturn r;`,
  next => `let r = ${next}(x);\nreturn r;`,
  next => `var r = ${next}(x);\nreturn r;`,
  (next, typed) => `const r${annotate(typed)} = ${next}(x);\nreturn r;`,
  (next, typed) => `let r${annotate(typed, "any")} = ${next}(x);\nreturn r;`,
  next => `const r = ${next}(x);\nconst s = r;\nreturn s;`,
  next => `const r = ${next}(x);\nconst s = r;\nconst t = s;\nreturn t;`,
  next => `const r = ${next}(x);\nlet s = r;\nreturn s;`,
  next => `const r = ${next}(x);\nreturn (r);`,
  next => `const r = (${next}(x));\nreturn r;`,
  next => `const r = ${next}(x);\nreturn r, r;`,
  next => `const r = ${next}(x);\nreturn 0, r;`,
  next => `const r = ${next}(x);\nreturn void 0, r;`,
  next => `const r = ${next}(x);\n{\nreturn r;\n}`,
  next => `{\nconst r = ${next}(x);\nreturn r;\n}`,
  next => `const r = ${next}(x);\nif (x >= 0) return r;\nreturn 0;`,
  next => `if (x >= 0) {\nconst r = ${next}(x);\nreturn r;\n}\nreturn 0;`,
  next => `if (x < 0) return 0;\nelse {\nconst r = ${next}(x);\nreturn r;\n}`,
  next => `const r = ${next}(x);\ntry {\nreturn r;\n} finally {\n}`,
  next => `try {\nconst r = ${next}(x);\nreturn r;\n} catch (error) {\nthrow error;\n}`,
  next => `try {\nconst r = ${next}(x);\nreturn r;\n} finally {\nx++;\n}`,
  next => `try {\nthrow x;\n} catch (caught) {\nconst r = ${next}(caught);\nreturn r;\n}`,
  next => `try {\n} finally {\nconst r = ${next}(x);\nreturn r;\n}`,
  next => `const r = x >= 0 ? ${next}(x) : other(x);\nreturn r;`,
  next => `const r = x < 0 ? other(x) : ${next}(x);\nreturn r;`,
  next => `const r = x >= 0 && ${next}(x);\nreturn r;`,
  next => `const r = x < 0 || ${next}(x);\nreturn r;`,
  next => `const r = null ?? ${next}(x);\nreturn r;`,
  next => `const r = nothing ?? ${next}(x);\nreturn r;`,
  next => `const r = ${next}(x) ?? 0;\nreturn r;`,
  next => `const r = ${next}(x) || 0;\nreturn r;`,
  next => `const r = (0, ${next})(x);\nreturn r;`,
  next => `const r = (x, ${next}(x));\nreturn r;`,
  next => `const r = ${next}?.(x);\nreturn r;`,
  next => `const r = ${next}.call(undefined, x);\nreturn r;`,
  next => `const r = ${next}.apply(undefined, [x]);\nreturn r;`,
  next => `const r = Reflect.apply(${next}, undefined, [x]);\nreturn r;`,
  next => `const r = ${next}.bind(undefined)(x);\nreturn r;`,
  next => `const r = ${next}(...[x]);\nreturn r;`,
  next => `const r = table.${next}(x);\nreturn r;`,
  next => `const r = table["${next}"](x);\nreturn r;`,
  next => `const r = table[name${"`"}${next}${"`"}](x);\nreturn r;`,
  next => `const r = table?.${next}(x);\nreturn r;`,
  next => `const r = new Made(${next}, x);\nreturn r.result;`,
  next => `const r = new Made(${next}, x).result;\nreturn r;`,
  next => `const r = tag(${next})${"`"}t${"`"};\nreturn r;`,
  next => `const { r } = { r: ${next}(x) };\nreturn r;`,
  next => `const [r] = [${next}(x)];\nreturn r;`,
  next => `const a = 1,\nr = ${next}(x);\nreturn r;`,
  next => `const r = ${next}(x),\nb = 1;\nreturn r;`,
  next => `const a = x,\nr = ${next}(a);\nreturn r;`,
  next => `const a = x;\nconst r = ${next}(a);\nreturn r;`,
  next => `const r = ${next}(x);\nconst unused = 1;\nreturn r;`,
  next => `const r = ${next}(x);\n;\nreturn r;`,
  next => `const r = ${next}(x);\nx++;\nreturn r;`,
  next => `const r = ${next}(x);\nreturn r + "";`,
  next => `const r = ${next}(x);\nreturn \`\${r}\`;`,
  next => `const r = ${next}(x);\nreturn String(r);`,
  next => `const r = ${next}(x);\nreturn same(r);`,
  next => `const r = ${next};\nreturn r(x);`,
  next => `const r = () => ${next}(x);\nreturn r();`,
  next => `const r = ${next}(x);\nreturn (() => r)();`,
  next => `const r = ${next}(x);\nreturn [r][0];`,
  next => `const r = ${next}(x);\nreturn { r }.r;`,
  next => `const r = ${next}(x);\nreturn x >= 0 ? r : 0;`,
  next => `const r = ${next}(x);\nreturn r ?? 0;`,
  next => `const r = ${next}(x);\nreturn nothing ?? r;`,
  next => `const r = ${next}(x);\nreturn x >= 0 && r;`,
  next => `for (;;) {\nconst r = ${next}(x);\nreturn r;\n}`,
  next => `for (const each of [x]) {\nconst r = ${next}(each);\nreturn r;\n}`,
  next => `for (const key in { k: 1 }) {\nconst r = ${next}(x);\nreturn r;\n}`,
  next => `while (true) {\nconst r = ${next}(x);\nreturn r;\n}`,
  next => `do {\nconst r = ${next}(x);\nreturn r;\n} while (false);`,
  next => `label: {\nconst r = ${next}(x);\nreturn r;\n}`,
  next => `switch (x >= 0) {\ncase true:\nconst r = ${next}(x);\nreturn r;\n}`,
  next => `switch (x >= 0) {\ncase true: {\nconst r = ${next}(x);\nreturn r;\n}\ndefault:\nreturn 0;\n}`,
  next => `const r = ${next}(x);\neval("");\nreturn r;`,
  next => `eval("");\nconst r = ${next}(x);\nreturn r;`,
  next => `const r = ${next}(x);\n(0, eval)("");\nreturn r;`,
  next => `const r = ${next}(arguments[0]);\nreturn r;`,
  next => `const r = ${next}(x);\nreturn arguments.length ? r : 0;`,
  next => `let r;\nr = ${next}(x);\nreturn r;`,
  next => `let r = 0;\nr = ${next}(x);\nreturn r;`,
  next => `let r = ${next}(x);\nr = r;\nreturn r;`,
  next => `let r;\nreturn (r = ${next}(x));`,
  next => `const r = ${next}(x);\nfunction inner() {\nreturn 1;\n}\nreturn r;`,
  next => `const r = ${next}(x);\nreturn r;\nfunction inner() {\nreturn r;\n}`,
  next => `const r = ${next}(x);\nreturn r;\nreturn r;`,
  next => `"use strict";\nconst r = ${next}(x);\nreturn r;`,
  (next, typed) => `const r = ${next}(x)${typed ? " as unknown" : ""};\nreturn r;`,
  (next, typed) => `const r = ${next}(x)${typed ? "!" : ""};\nreturn r;`,
  (next, typed) => `const r = ${next}(x);\nreturn r${typed ? " as any" : ""};`,
  (next, typed) => `const r = ${next}(x);\nreturn r${typed ? "!" : ""};`,
  (next, typed) => `const r = ${typed ? "<any>" : ""}${next}(x);\nreturn r;`,
  (next, typed) => `const r = ${next}(x)${typed ? " satisfies unknown" : ""};\nreturn r;`,
  next => `using held = { [Symbol.dispose]() {} };\nconst r = ${next}(x);\nreturn r;`,
  next => `return ${next}(x);`,
  next => `return (${next}(x));`,
  next => `const r = ${next}(x);\nthrow { caught: r };`,
];

export const wrappers: readonly ((name: string, body: string, typed: boolean) => string)[] = [
  (name, body, typed) => `function ${name}(x${annotate(typed, "any")}) {\n${body}\n}`,
  (name, body, typed) => `const ${name} = function (x${annotate(typed, "any")}) {\n${body}\n};`,
  (name, body, typed) => `const ${name} = function ${name}(x${annotate(typed, "any")}) {\n${body}\n};`,
  (name, body, typed) => `const ${name} = { ${name}(x${annotate(typed, "any")}) {\n${body}\n} }.${name};`,
  (name, body, typed) =>
    `const ${name} = class {\nstatic ${name}(x${annotate(typed, "any")}) {\n${body}\n}\n}.${name};`,
  (name, body, typed) => `function ${name}(x${annotate(typed, "any")}, spare = 0) {\n${body}\n}`,
  (name, body, typed) =>
    `function ${name}(x${annotate(typed, "any")}, ...rest${annotate(typed, "any[]")}) {\n${body}\n}`,
];

// The checker refuses a comma whose left side does nothing.
export const passesTheChecker = (body: string) => !/return (?:r|0|void 0), r;|= \(x, |\(0, (?!eval)/.test(body);

export const arrow = (name: string, body: string, typed: boolean) =>
  `const ${name} = (x${annotate(typed, "any")}) => {\n${body}\n};`;

export function generate(random: Random, typed = false): string {
  const length = random.between(2, 9);
  const strict = random.chance(0.7);
  const functions: string[] = [];
  for (let index = 0; index < length; index++) {
    const next = index + 1 === length ? "last" : `f${index + 1}`;
    let body = random.pick(bodies)(next, typed);
    while (typed && !passesTheChecker(body)) body = random.pick(bodies)(next, typed);
    const usesArguments = body.includes("arguments");
    const hasDirective = body.startsWith(`"use strict"`);
    const wrapper = hasDirective ? random.pick(wrappers.slice(0, 5)) : random.pick(wrappers);
    functions.push(
      !usesArguments && random.chance(0.25) ? arrow(`f${index}`, body, typed) : wrapper(`f${index}`, body, typed),
    );
  }
  const names = Array.from({ length }, (_, index) => `f${index}`);
  return `${strict ? `"use strict";\n` : typed ? "" : "module.exports = {};\n"}const nothing = globalThis[process.argv[2] ?? "nothing"];
const lines${typed ? ": string[]" : ""} = [];
const name = (parts${annotate(typed, "any")}) => parts[0];
const same = (value${annotate(typed, "any")}) => value;
const other = (value${annotate(typed, "any")}) => value;
const tag = (callee${annotate(typed, "any")}) => (...parts${annotate(typed, "any[]")}) => callee(parts.length);
class Made {
result${annotate(typed, "any")};
constructor(callee${annotate(typed, "any")}, x${annotate(typed, "any")}) {
this.result = callee(x);
}
}
function last(x${annotate(typed, "any")}) {
const found = [];
for (const line of String(new Error("here").stack).split("\\n")) {
const match = /^\\s*at (?:async )?(?:new )?([A-Za-z0-9_.]+) \\(/.exec(line);
if (match && /^(?:f[0-9]+|last|Made|start|same|tag|inner)$/.test(match[1])) found.push(match[1]);
}
lines.push(found.join(" < "));
return x + 1;
}
${functions.reverse().join("\n")}
const table${annotate(typed, "any")} = { last, ${names.join(", ")} };
function start(turn${annotate(typed, "number")}) {
try {
lines.push("answer " + f0(turn));
} catch (error) {
lines.push("thrown " + (error && typeof error === "object" && "caught" in error ? (error${typed ? " as any" : ""}).caught : String(error && (error${typed ? " as any" : ""}).name)));
}
}
for (let turn = 0; turn < ${random.pick([1, 1, 3, 40])}; turn++) start(turn);
console.log([...new Set(lines)].join("\\n"));
`;
}
