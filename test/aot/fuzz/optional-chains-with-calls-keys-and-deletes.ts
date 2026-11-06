// Optional chains whose links are members, computed keys and calls, over objects that tell of every read and every call.
//
//   links       `.name`, `?.name`, `[key]`, `?.[key]`, `(..)`, `?.(..)`, private names; where a chain ends early nothing behind that link runs: no key, no argument, no call
//   bases       objects, functions, proxies, `null`, `undefined`, `0`, `""`, `false`, texts and numbers with their methods, `this`, `super`, `new.target`, `import.meta`, `eval`
//   around      parentheses that end a chain, `delete`, `typeof`, `void`, `!`, `??`, `||`, `&&`, conditions, spreads, arguments, templates, `await`, heads of loops, chains inside keys and arguments of chains
//   calls       keep the receiver: of a member, of a member under a key, behind parentheses, of what a getter answers with
//   read        the order of all reads, keys, arguments and calls, the receiver of every call, what the chain answers or throws, and what `delete` has left
import type { Random } from "./random";

const head = `const lines = [];
function show(value) {
  if (value === null || typeof value !== "object") return typeof value === "function" ? "function " + value.name : typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
  return value.label ?? (Array.isArray(value) ? "[" + value.map(show).join(",") + "]" : "{" + Object.keys(value).join(",") + "}");
}
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell(label, value) {
  note("runs", label);
  return value;
}
function node(label, depth) {
  const below = depth > 0 ? node(label + ".p", depth - 1) : undefined;
  const made = {
    label,
    get p() {
      note("get p of", label);
      return below;
    },
    m(...given) {
      note("m of", label, "on", this === made ? "itself" : show(this), "with", given.length);
      return below;
    },
    get f() {
      note("get f of", label);
      return function f(...given) {
        note("f of", label, "on", this === made ? "its object" : show(this), "with", given.length);
        return below;
      };
    },
    n: null,
    u: undefined,
    z: 0,
    e: "",
    t: "text",
    d: { label: label + ".d", x: 1 },
    list: [1, 2],
  };
  return made;
}
function watched(label, target) {
  return new Proxy(target, {
    get(inner, key, receiver) {
      note("trap get", label, String(key));
      return Reflect.get(inner, key, receiver);
    },
    deleteProperty(inner, key) {
      note("trap delete", label, String(key));
      return Reflect.deleteProperty(inner, key);
    },
    apply(inner, receiver, given) {
      note("trap apply", label, given.length);
      return Reflect.apply(inner, receiver, given);
    },
  });
}
function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
`;

export function generate(random: Random): string {
  let count = 0;
  const chain = (depth: number, base?: string): string => {
    let text =
      base ??
      random.weighted([
        [8, "root"],
        [2, `tell("base ${count++}", root)`],
        [2, "nothing"],
        [1, "missing"],
        [1, `tell("base ${count++}", nothing)`],
        [1, "proxy"],
        [1, random.pick(["zero", "empty", "no", '"text"', "(5)", "root.m", "maker"])],
      ]);
    for (let left = random.between(1, 5); left > 0; left--) {
      const isOptional = random.chance(0.45);
      const name = random.weighted([
        [6, "p"],
        [3, "m"],
        [2, "f"],
        [2, "n"],
        [1, "u"],
        [1, random.pick(["z", "e", "t", "d", "list", "length", "absent", "toString"])],
      ]);
      const argument = () =>
        depth > 0 && random.chance(0.25)
          ? chain(depth - 1)
          : `tell("argument ${count++}", ${random.pick(["1", "root", "nothing"])})`;
      text += random.weighted([
        [5, () => `${isOptional ? "?." : "."}${name}`],
        [
          2,
          () =>
            `${isOptional ? "?." : ""}[${depth > 0 && random.chance(0.15) ? `${chain(depth - 1)} ?? "p"` : `tell("key ${count++}", "${name}")`}]`,
        ],
        [
          3,
          () =>
            `${isOptional ? "?." : "."}${random.pick(["m", "m", "f", "n", "absent"])}${random.pick(["", "?."])}(${random.pick(["", argument(), `${argument()}, ${argument()}`, `...${argument()}?.list ?? []`])})`,
        ],
        [1, () => `${isOptional ? "?." : ""}(${argument()})`],
      ])();
      if (random.chance(0.1)) text = `(${text})`;
    }
    return text;
  };

  const rows: string[] = [];
  for (let id = 0, scenes = random.between(12, 30); id < scenes; id++) {
    const text = chain(1);
    const isReference = !text.endsWith(")");
    const whole = random.weighted([
      [8, text],
      [isReference ? 4 : 0, `delete ${text}`],
      [1, `typeof ${text}`],
      [1, `void ${text}`],
      [1, `!${text}`],
      [2, `${text} ?? tell("the other side ${count++}", "other")`],
      [1, `${text} || tell("the other side ${count++}", "other")`],
      [1, `${text} && tell("the other side ${count++}", "other")`],
      [1, `${text} ? "yes" : "no"`],
      [1, `[...(${text} ?? [])]`],
      [1, `\`<\${${text}}>\`.length > 0`],
      [1, `[${text}, ${chain(0)}]`],
      [1, `(${text})?.label`],
      [1, `${text} === undefined`],
    ]);
    rows.push(
      `root = node("root", 3);\nproxy = watched("proxy", node("inner", 2));\nattempt(${JSON.stringify(whole)}, () => ${whole});`,
    );
    if (whole.startsWith("delete ")) rows.push(`note("left", Object.keys(root).join(), Object.keys(root.d).join());`);
  }

  const fixed = [
    `class Above {\nm() {\nreturn "Above.m on " + this.label;\n}\n}\nclass Below extends Above {\nlabel = "below";\n#hidden = node("hidden", 1);\n#secret() {\nreturn this.label;\n}\nstatic read(given) {\nreturn [given?.#hidden, given?.#hidden.p, given?.#hidden?.n?.p, given?.#secret(), given?.#secret?.()];\n}\nrun() {\nreturn [super.m?.(), super.absent?.(), super.absent?.x, super["m"]?.(), this?.label, this?.#hidden?.label, new.target?.name];\n}\n}\nattempt("private names", () => Below.read(new Below()));\nattempt("private names of nothing", () => Below.read(nothing));\nattempt("private names of a stranger", () => Below.read({}));\nattempt("super", () => new Below().run());`,
    `function made() {\nreturn [new.target?.name, new.target?.prototype?.constructor === made];\n}\nattempt("new.target", () => [made(), new made() instanceof made]);\nattempt("import.meta", () => [typeof import.meta?.url, import.meta?.absent?.x, import.meta.absent?.()]);`,
    `{\nconst local = "a local";\nglobalThis.local = "a global";\nattempt("eval behind a link", () => [eval("local"), eval?.("local"), (0, eval)("local"), globalThis.eval?.("local")]);\ndelete globalThis.local;\n}`,
    `attempt("await", async () => (await nothing?.p, await root?.p?.label));\nfor (const each of nothing?.list ?? root?.list) note("turn", each);\nfor (const key in nothing?.d ?? root?.d) note("key", key);`,
    `attempt("texts and numbers", () => ["text"?.length, "text"?.[0], "text"?.at?.(-1), (5)?.toFixed?.(1), (5)?.absent?.(), true?.valueOf(), 1n?.toString(), Symbol.iterator?.description]);`,
    `attempt("a call that is not there", () => root.absent?.(tell("never", 1)));\nattempt("a call of what is no function", () => root.z?.(tell("an argument all the same", 1)));\nattempt("a call of a text", () => root?.t(tell("an argument all the same", 1)));`,
  ];
  return `${head}let root = node("root", 3);\nlet proxy = watched("proxy", node("inner", 2));\nconst nothing = null,\nmissing = undefined,\nzero = 0,\nempty = "",\nno = false;\nconst maker = watched("maker", function maker() {\nreturn root;\n});\n${rows.join("\n")}\n${random.sample(fixed, random.between(2, fixed.length)).join("\n")}\nawait null;\nconsole.log(lines.join("\\n"));\n`;
}
