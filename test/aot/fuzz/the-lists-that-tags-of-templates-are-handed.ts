// Tagged templates, and which list of texts each of them hands to its tag: one place in the source has one list, however often and from wherever it runs, and two places never share one.
//
//   places      functions, arrows, closures made once and made anew for every call, methods, static methods, getters, values of fields, static blocks, generators, async functions, defaults of
//               parameters, callbacks of array methods, loops, both arms of a condition, clauses of `switch`, `try`, `catch` and `finally`, templates inside templates, functions that call themselves,
//               text made at run time by `new Function` and `eval`, a second file
//   reached     straight, through one and through two other functions, through `call`, `apply` and `Reflect.apply`, through a function that calls what it is handed twice, out of lists of functions
//   tags        a function, a method with its `this`, a bound function, a proxy, what a call answers with, a tag that answers with a tag, `String.raw`
//   texts       the same text in two places, no text at all, escapes that are no escapes, line ends of every kind
//   read        a number for each list in the order in which the lists are first seen, the texts, the raw texts, the values; whether the lists can be changed; caches keyed by the lists
import type { Random } from "./random";

const head = `const lines = [];
const numbers = new Map();
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function tag(strings, ...values) {
  if (!numbers.has(strings)) numbers.set(strings, numbers.size);
  return "#" + numbers.get(strings) + JSON.stringify(Array.from(strings, each => each ?? "no text")) + JSON.stringify(strings.raw) + values.join(",");
}
const holder = {
  name: "holder",
  tag(strings, ...values) {
    return this.name + tag(strings, ...values);
  },
};
const bound = tag.bind(null);
const behind = new Proxy(tag, {});
const gives = () => tag;
function again(strings) {
  const first = tag(strings);
  return (more, ...values) => first + tag(more, ...values);
}
const built = new WeakMap();
function cached(strings, ...values) {
  if (!built.has(strings)) built.set(strings, "built " + built.size + strings.length);
  const known = numbers.has(strings);
  return (known ? "known " : "new ") + tag(strings, ...values);
}
function twice(run, given) {
  return [run(given), run(given)];
}
`;

export function generate(random: Random): { text: string; files: Record<string, string> } {
  let texts = 0;
  const shared = ["same", "", "a", "x${0}y"];
  /** A tagged template. Most have a text of their own; some have the text of another place. */
  const site = (value = "x"): string => {
    const name = random.weighted([
      [8, "tag"],
      [2, "holder.tag"],
      [1, "bound"],
      [1, "behind"],
      [1, "gives()"],
      [1, "cached"],
      [1, "(tag)"],
      [1, 'holder["tag"]'],
    ]);
    const body = random.weighted([
      [8, () => `t${texts++} \${${value}} end`],
      [2, () => `t${texts++}`],
      [3, () => random.pick(shared)],
      [1, () => `t${texts++} \\n \\\\ \\\` \\$ \\u{41} \${${value}}`],
      [
        1,
        () => `t${texts++} ${random.pick(["\\u{g}", "\\xz", "\\01", "\\u12", "\\u{110000}"])} \${${value}} \\unicode`,
      ],
      [1, () => `t${texts++}\n second line \${${value}}\n`],
      [1, () => `\${${value}}\${${value}}`],
    ])();
    return random.chance(0.05) ? `again\`first ${texts++}\`\`${body}\`` : `${name}\`${body}\``;
  };

  const rows: string[] = [];
  const names: string[] = [];
  const count = random.between(4, 9);
  for (let id = 0; id < count; id++) {
    const name = `h${id}`;
    names.push(name);
    rows.push(
      random.pick<() => string>([
        () => `function ${name}(x) {\nreturn ${site()};\n}`,
        () => `function ${name}(x) {\nreturn ${site()};\n}`,
        () => `const ${name} = x => ${site()};`,
        () => `const ${name} = (() => {\nconst kept = 1;\nreturn x => ${site("x + kept")};\n})();`,
        () => `function make${id}(kept) {\nreturn x => ${site("x + kept")};\n}\nconst ${name} = x => make${id}(x)(x);`,
        () =>
          `function make${id}() {\nreturn function () {\nreturn ${site("1")};\n};\n}\nconst ${name} = x => [make${id}()(), make${id}()(), new (make${id}())() instanceof Object];`,
        () =>
          `class C${id} {\nfield = ${site("1")};\nstatic fixed = ${site("2")};\nstatic {\nnote("static block", ${site("3")});\n}\nm(x) {\nreturn ${site()};\n}\nstatic s(x) {\nreturn ${site()};\n}\nget g() {\nreturn ${site("4")};\n}\n}\nconst ${name} = x => [new C${id}().m(x), C${id}.s(x), new C${id}().field, new C${id}().g, C${id}.fixed];`,
        () =>
          `function* steps${id}(x) {\nyield ${site()};\nyield ${site()};\nreturn ${site()};\n}\nconst ${name} = x => [...steps${id}(x), steps${id}(x).next().value];`,
        () => `async function ${name}(x) {\nconst first = ${site()};\nawait null;\nreturn [first, ${site()}];\n}`,
        () => `function ${name}(x, y = ${site()}, { z = ${site()} } = {}) {\nreturn [y, z];\n}`,
        () => `function ${name}(x) {\nreturn x > 0 ? ${name}(x - 1) + " | " + ${site()} : ${site()};\n}`,
        () => `function ${name}(x) {\nreturn ${site(site())};\n}`,
        () =>
          `function ${name}(x) {\nconst list = [];\nfor (let turn = 0; turn < 3; turn++) list.push(${site("turn")});\nreturn list;\n}`,
        () => `const ${name} = x => [1, 2].map(each => ${site("each")});`,
        () => `function ${name}(x) {\nreturn [tag\`same\`, tag\`same\`, tag\`same\` === tag\`same\`, ${site()}];\n}`,
        () =>
          `function ${name}(x) {\ntry {\nif (x) throw ${site()};\nreturn ${site()};\n} catch (error) {\nreturn [error, ${site()}];\n} finally {\nnote("finally", ${site()});\n}\n}`,
        () => `function ${name}(x) {\nreturn x % 2 ? ${site()} : ${site()};\n}`,
        () =>
          `function ${name}(x) {\nswitch (x) {\ncase 0:\nreturn ${site()};\ncase 1:\nreturn ${site()};\ndefault:\nreturn ${site()};\n}\n}`,
        () =>
          `const ${name} = new Function("tag", "x", "return tag\`made at run time ${texts++} \${x}\`").bind(null, tag);`,
        () => `const ${name} = x => new Function("tag", "x", "return tag\`made anew ${texts++} \${x}\`")(tag, x);`,
        () => `const ${name} = x => eval("tag\`evaluated ${texts++} \${x}\`");`,
        () => `const ${name} = x => [String.raw\`a\\n\${x}\\u{g}\`, String.raw({ raw: ["p", "q"] }, x), ${site()}];`,
        () => `const ${name} = x => other(x);`,
        () =>
          `const ${name} = {\nname: "an object",\ntag: holder.tag,\nrun(x) {\nreturn this.tag\`t${texts++} \${x}\`;\n},\n}.run;`,
      ])(),
    );
  }

  const drivers: string[] = [];
  for (let left = random.between(6, 14); left > 0; left--) {
    const name = random.pick(names);
    const more = random.pick(names);
    drivers.push(
      random.pick<() => string>([
        () => `for (const given of [0, 1, 2, 0]) await attempt("${name}", () => ${name}(given));`,
        () => `await attempt("${name} once", () => ${name}(1));`,
        () => `await attempt("${name} twice", () => Promise.all(twice(${name}, 1)));`,
        () =>
          `function through${left}(x) {\nreturn ${name}(x);\n}\nfunction further${left}(x) {\nreturn through${left}(x);\n}\nawait attempt("${name} through one", () => through${left}(0));\nawait attempt("${name} through two", () => further${left}(0));`,
        () =>
          `await attempt("${name} by call", () => ${name}.call(holder, 1));\nawait attempt("${name} by apply", () => ${name}.apply(holder, [1]));\nawait attempt("${name} by Reflect.apply", () => Reflect.apply(${name}, holder, [1]));`,
        () =>
          `await attempt("${name} and ${more} out of a list", () => Promise.all([${name}, ${more}, ${name}].map(run => run(2))));`,
        () =>
          `for (let turn = 0; turn < 300; turn++) await ${name === "h0" ? more : name}.call(holder, turn % 3);\nnote("lists after 300 turns", numbers.size);`,
      ])(),
    );
  }

  const text = `import { other } from "./other.js";\n${head}async function attempt(label, run) {\ntry {\nnote(label, await run());\n} catch (error) {\nnote(label, "THROWS", error.constructor.name);\n}\n}\nglobalThis.tagOfTheFirstFile = tag;\n${rows.join("\n")}\n${drivers.join("\n")}
for (const [strings, number] of numbers) {
  const about = [Object.isFrozen(strings), Object.isFrozen(strings.raw), Array.isArray(strings), Array.isArray(strings.raw), Reflect.ownKeys(strings).join(), JSON.stringify(Object.getOwnPropertyDescriptor(strings, "raw")), strings.raw === strings.raw];
  for (const change of [() => strings.push("more"), () => (strings[0] = "other"), () => (strings.raw = []), () => delete strings[0], () => strings.raw.pop(), () => Object.defineProperty(strings, "more", { value: 1 })]) {
    try {
      change();
      about.push("changed");
    } catch (error) {
      about.push(error.constructor.name);
    }
  }
  note("list", number, about.join(" "));
}
note("lists", numbers.size);
console.log(lines.join("\\n"));
`;
  return {
    text,
    files: {
      "other.js": `export function other(x) {\nreturn [globalThis.tagOfTheFirstFile\`same\`, globalThis.tagOfTheFirstFile\`in the other file \${x}\`, globalThis.tagOfTheFirstFile\`a\`];\n}\n`,
    },
  };
}
