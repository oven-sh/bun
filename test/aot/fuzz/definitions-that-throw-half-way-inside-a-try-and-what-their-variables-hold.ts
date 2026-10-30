// Inside try blocks, at the top level, in functions and in loops, classes are defined whose definition may throw half way: what stands behind
// `extends` is no constructor, throws, has a prototype that is no object or is a variable that an earlier failure left as it was; a computed key,
// a static field or a static block throws or names the class itself. Behind each try block the variables that would have taken the class are
// constructed, called, extended again, read, compared, listed and handed on, each use in a try block of its own.
import type { Random } from "./random";

export function generate(random: Random): string {
  const lines: string[] = [
    `function pass<T>(value: T): T { return value; }`,
    `const told: string[] = [];`,
    `const show = (value: unknown): string => { try { return typeof value === "function" ? "function " + (value as Function).name : typeof value === "object" && value !== null ? (value as object).constructor?.name + JSON.stringify(value) : String(value); } catch (error) { return "threw " + (error as Error).name; } };`,
    `function attempt(name: string, run: () => unknown) { try { console.log(name, show(run())); } catch (error) { console.log(name, "threw", (error as Error).name); } }`,
    `function fail(): never { throw new RangeError("fails"); }`,
    `class Real { tag = "real"; static made = 0; constructor() { Real.made++; } hello() { return "hello " + this.tag; } }`,
    `interface Shape { tag: string }`,
    `type Maker = new () => Shape;`,
  ];
  const count = random.between(2, 5);
  const variables: string[] = [];
  const start = () =>
    random.pick([
      `undefined`,
      `undefined`,
      `null`,
      `7`,
      `"text"`,
      `{ tag: "object" }`,
      `() => ({ tag: "arrow" })`,
      `Real`,
      `function () {}.bind(null)`,
      `Symbol.iterator`,
      `class { tag = "first"; }`,
      `new Proxy(Real, {})`,
    ]);
  const type = () =>
    random.pick([
      `any`,
      `unknown`,
      `Maker`,
      `typeof Real`,
      `Shape`,
      `Real`,
      `Maker | undefined`,
      `{}`,
      `object | null`,
    ]);
  const block = (v: number, indent: string) => {
    const name = `C${v}`,
      held = `v${v}`;
    const earlier = variables.length ? random.pick(variables) : "undefined";
    const heritage = random.pick([
      `(${earlier} as any)`,
      `(${earlier} as any)`,
      `(${earlier} as any)`,
      `(undefined as any)`,
      `(null as any)`,
      `(7 as any)`,
      `(fail() as any)`,
      `Real`,
      `(pass(${earlier}) as any)`,
      `((() => {}) as any)`,
      `(Object.assign(function () {}, { prototype: 3 }) as any)`,
      `(Int16Array as any)`,
      `(function* () {} as any)`,
      `(${held} as any)`,
      `(new Proxy(Real, { get(target, key) { if (key === "prototype") fail(); return Reflect.get(target, key); } }) as any)`,
      `(Real.prototype as any)`,
      `(class extends (${earlier} as any) {} as any)`,
    ]);
    const member = random
      .pick([
        ``,
        ``,
        ``,
        `tag = "heir";`,
        `// @ts-ignore\n${indent}    [${name}] = 1;`,
        `[fail()] = 1;`,
        `static at = fail();`,
        `static { fail(); }`,
        `static self = ${name};`,
        `static { told.push("static block of ${name}"); }`,
        `[(told.push("key of ${name}"), "key")]() { return 1; }`,
        `static [String(${earlier})] = 1;`,
        `constructor() { super(); told.push("made ${name}"); }`,
        `hello() { return "heir " + super.hello(); }`,
        `static made2 = new ${name}();`,
      ])
      .replace(/^(?!\/\/)(?=.)/, `// @ts-ignore\n${indent}    `);
    const form = random.below(4);
    const define =
      form === 0
        ? `class ${name} extends ${heritage} {\n${indent}    ${member}\n${indent}  }\n${indent}  ${held} = ${name} as any;`
        : form === 1
          ? `const ${name} = class extends ${heritage} {\n${indent}    ${member}\n${indent}  };\n${indent}  told.push(typeof ${name});\n${indent}  ${held} = ${name} as any;`
          : form === 2
            ? `${held} = class ${name} extends ${heritage} {\n${indent}    ${member}\n${indent}  } as any;`
            : `${held} = pass(class ${name} extends ${heritage} {\n${indent}    ${member}\n${indent}  }) as any;`;
    const before = random.pick([
      ``,
      ``,
      `told.push("before ${name}");`,
      `${held} = (${start()}) as any;`,
      `if (told.length > 90) ${held} = Real as any;`,
    ]);
    const handler = random.pick([
      `catch {}`,
      `catch (error) { told.push((error as Error).name); }`,
      `catch (error) { told.push((error as Error).name); } finally { told.push("finally ${v}"); }`,
      `catch { ${held} = (${random.pick([held, start(), earlier])}) as any; }`,
    ]);
    return `${indent}try {\n${indent}  ${before}\n${indent}  ${define}\n${indent}} ${handler}`;
  };
  const use = (held: string) =>
    random.pick([
      `new (${held} as any)()`,
      `new (${held} as any)()`,
      `new (${held} as any)().tag`,
      `(${held} as any)()`,
      `new (${held} as any)().hello()`,
      `${held}`,
      `typeof ${held}`,
      `(${held} as any).name`,
      `(${held} as any).prototype`,
      `${held} === undefined`,
      `(${held} as any) instanceof Function`,
      `new Real() instanceof (${held} as any)`,
      `Object.getPrototypeOf(${held})`,
      `Reflect.construct(${held} as any, [])`,
      `Reflect.construct(Real, [], ${held} as any)`,
      `new (class extends (${held} as any) {})()`,
      `Object.keys(${held} as any)`,
      `(${held} as any)?.made`,
      `[${held}].map(each => new (each as any)())`,
      `pass(${held})`,
      `String(${held}).length > 0`,
      `(${held} as any).self === ${held}`,
      `new (pass(${held}) as any)()`,
      `(${held} as any).call({})`,
      `new new Proxy(${held} as any, {})()`,
    ]);
  for (let v = 0; v < count; v++) {
    const where = random.below(5);
    const declare = `${random.pick(["let", "let", "var"])} v${v}: ${type()} = ${random.chance(0.5) ? `pass<any>(${start()})` : `(${start()}) as any`};`;
    if (where <= 2) lines.push(declare, block(v, ""));
    else if (where === 3)
      lines.push(
        declare,
        `function define${v}() {\n${block(v, "  ")}\n}`,
        `define${v}();`,
        ...(random.chance(0.3) ? [`define${v}();`] : []),
      );
    else lines.push(declare, `for (let turn = 0; turn < ${random.pick([1, 2, 3])}; turn++) {\n${block(v, "  ")}\n}`);
    variables.push(`v${v}`);
    for (let n = random.between(0, 3); n > 0; n--) {
      const held = random.pick(variables);
      lines.push(`attempt("${held}", () => ${use(held)});`);
    }
    if (random.chance(0.2)) {
      const held = random.pick(variables);
      lines.push(`try { ${use(held)}; } catch (e) {}`);
    }
  }
  for (const held of variables) lines.push(`attempt("${held} at the end", () => ${use(held)});`);
  lines.push(`console.log(told.join(", "));`, `console.log(Real.made);`);
  return lines.join("\n") + "\n";
}
