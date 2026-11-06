// Classes with private fields, methods, getters and setters, of the instance and static, whose members are asked of every kind of object.
//
//   members     fields with and without values, methods, generators, async methods, getters alone, setters alone, pairs; the same of the class itself
//   uses        read, store, every compound assignment, `++`, a call, `#name in`, behind `?.`, as a target of patterns and of loop heads, in closures, in classes inside the class, in static blocks
//               that hand functions out
//   asked of    an instance, an instance of a class below, of a class above, of another class with the same names, of the same class text evaluated again, a proxy round an instance, a frozen instance,
//               an object that a constructor above returned and that was so given the names, one given them twice, `null`, `undefined`, a number, the class, the prototype
//   too early   a method of the class below called by the constructor above, a field's value that reads a later field
//   order       the object, then the value, then the question whether the object has the name
//   read        what each use answers or throws, and that no private name shows among the keys
import type { Random } from "./random";

const head = `const lines = [];
function show(value, depth = 0) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return String(value);
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 2) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show(value[key], depth + 1)).join(",") + "}";
}
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell(label, value) {
  note("runs", label);
  return value;
}
function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
class Returns {
  constructor(given) {
    return given;
  }
}
`;

export function generate(random: Random): string {
  const rows: string[] = [];
  for (let id = 0, scenes = random.between(2, 5); id < scenes; id++) {
    const members: string[] = [];
    const uses: [string, string][] = [];
    const kinds = random.sample(
      [
        "field",
        "bare",
        "method",
        "getter",
        "setter",
        "pair",
        "static field",
        "static method",
        "static pair",
        "generator",
        "async",
      ],
      random.between(2, 6),
    );
    for (const kind of kinds) {
      const name = `#${kind.replace(" ", "")[0]}${kinds.indexOf(kind)}`;
      const value = random.pick(["1", '"text"', "[1]", "{ a: 1 }", "null", "undefined", "() => 1", "0.5"]);
      if (kind === "field") members.push(`${name} = tell("${name}", ${value});`);
      else if (kind === "bare") members.push(`${name};`);
      else if (kind === "method")
        members.push(`${name}(given) {\nreturn ["${name}", this === undefined ? "nothing" : typeof this, given];\n}`);
      else if (kind === "getter") members.push(`get ${name}() {\nreturn "from the getter ${name}";\n}`);
      else if (kind === "setter") members.push(`set ${name}(given) {\nnote("the setter ${name} gets", given);\n}`);
      else if (kind === "pair")
        members.push(
          `get ${name}() {\nreturn this.held ?? "nothing held";\n}\nset ${name}(given) {\nthis.held = given;\n}`,
        );
      else if (kind === "static field") members.push(`static ${name} = tell("static ${name}", ${value});`);
      else if (kind === "static method")
        members.push(`static ${name}(given) {\nreturn ["static ${name}", typeof this, given];\n}`);
      else if (kind === "static pair")
        members.push(
          `static get ${name}() {\nreturn "from the static getter";\n}\nstatic set ${name}(given) {\nnote("the static setter gets", given);\n}`,
        );
      else if (kind === "generator") members.push(`*${name}() {\nyield "${name}";\n}`);
      else members.push(`async ${name}() {\nreturn "${name}";\n}`);
      const all: [string, string][] = [
        ["read", `o.${name}`],
        ["store", `(o.${name} = 5)`],
        ["add", `(o.${name} += 1)`],
        ["step", `o.${name}++`],
        ["or", `(o.${name} ||= "or")`],
        ["and", `(o.${name} &&= "and")`],
        ["nullish", `(o.${name} ??= "nullish")`],
        ["call", `o.${name}(1)`],
        ["has", `${name} in o`],
        ["chain", `o?.${name}`],
        ["chain call", `o?.${name}?.(2)`],
        ["pattern", `([o.${name}] = ["by a pattern"])`],
        ["object pattern", `({ a: o.${name} } = { a: "by an object pattern" })`],
        ["loop", `(() => {\nfor (o.${name} of ["by a loop"]);\nreturn o.${name};\n})()`],
        ["closure", `(() => o.${name})()`],
        ["order", `(tell("the object", o).${name} = tell("the value", 6))`],
        ["typeof", `typeof o.${name}`],
        ["inner class", `new (class {\nread() {\nreturn o.${name};\n}\n})().read()`],
        ["spread call", `o.${name}(...[1, 2])`],
        ["tag", `o.${name}\`text\``],
      ];
      uses.push(
        ...random
          .sample(all, random.between(3, 7))
          .map(([label, text]): [string, string] => [`${label} ${name}`, text]),
      );
    }
    const asks = uses.map(([label, text], at) => `static ask${at}(o) {\nreturn ${text};\n}`);
    const early = random.chance(0.3);
    const firstField = kinds.includes("field") ? `#f${kinds.indexOf("field")}` : undefined;
    rows.push(
      `function define${id}() {\nclass Above${id} {\nconstructor() {\n${early ? `attempt("too early", () => this.early());` : ""}\n}\n}\nclass Holder${id} extends Above${id} {\n${members.join("\n")}\n${asks.join("\n")}\nearly() {\nreturn ${firstField ? `this.${firstField}` : `"no field"`};\n}\nstatic stamp(given) {\nreturn new Stamps${id}(given);\n}\n}\nclass Below${id} extends Holder${id} {}\nclass Stamps${id} extends Returns {\n#stamped = 1;\nstatic has(o) {\nreturn #stamped in o;\n}\n}\nreturn { Above: Above${id}, Holder: Holder${id}, Below: Below${id}, Stamps: Stamps${id} };\n}`,
      `{\nconst first = define${id}();\nconst second = define${id}();\nconst plain = { plain: true };\nattempt("stamped", () => [first.Stamps.has(plain), first.Stamps.has(new first.Stamps(plain)), first.Stamps.has(plain), second.Stamps.has(plain), Reflect.ownKeys(plain)]);\nattempt("stamped twice", () => new first.Stamps(plain));\nattempt("stamped by the other", () => second.Stamps.has(new second.Stamps(plain)));\nattempt("a frozen object is stamped", () => first.Stamps.has(new first.Stamps(Object.freeze({}))));\nattempt("a proxy is stamped", () => {\nconst target = {};\nconst proxy = new Proxy(target, {});\nnew first.Stamps(proxy);\nreturn [first.Stamps.has(proxy), first.Stamps.has(target)];\n});\nconst makers = {\n"an instance": () => new first.Holder(),\n"an instance of the class below": () => new first.Below(),\n"an instance of the class above": () => new first.Above(),\n"an instance of the class evaluated again": () => new second.Holder(),\n"a proxy": () => new Proxy(new first.Holder(), {}),\n"a frozen instance": () => Object.freeze(new first.Holder()),\n"an object below an instance": () => Object.create(new first.Holder()),\n"null": () => null,\n"undefined": () => undefined,\n"a number": () => 1,\n"the class": () => first.Holder,\n"the class below": () => first.Below,\n"the prototype": () => first.Holder.prototype,\n"a plain object": () => ({}),\n};\nfor (const [who, make] of Object.entries(makers)) {\nnote("scene ${id}:", who);\n${uses.map(([label], at) => `attempt(${JSON.stringify(label)}, () => first.Holder.ask${at}(make()));`).join("\n")}\n}\nnote("keys", Reflect.ownKeys(new first.Holder()), Reflect.ownKeys(first.Holder).filter(key => !String(key).startsWith("ask")), Reflect.ownKeys(first.Holder.prototype), JSON.stringify(new first.Holder()));\n}`,
    );
  }
  return `${head}${rows.join("\n")}\nawait null;\nconsole.log(lines.join("\\n"));\n`;
}
