// Small programs in which the operators that are used on a variable, or its declared type, promise one kind of value, the variable holds another kind at run time, and something whose form is
// chosen when it is made (a list of numbers, a view, an object) is made of it. A closure has captured the variable and may store to it between two reads. Each case has a function, a value and
// keys of its own, and prints what it reads on the spot: what several cases share is known less well.
//
//   the promise      `|=`, `^=`, `&=`, `<<=`, `>>=`, `>>>=`, `++`, `*=`, `+= ""`, `= ~n`, `= +n`, `||=`, `??=`; in TypeScript a declared `number`, `string` or `boolean` and a value `as any`
//   the variable     a parameter, one with a default, one taken out of a pattern, a rest parameter's element, a `let`, a `var`, the variable of a `for of`, of a `catch`
//   who stores       an arrow called on the spot between two elements, an arrow or a function declared elsewhere, a method, a getter; called between, behind, ahead, or never
//   the value        fractions, -0, NaN, numbers past 32 bits, a text, a boolean, null, undefined, a list, an object with `valueOf`
//   what is made     a list, one with a hole, nested, with a spread, `Array.of`, `new Array`, a view of numbers, an object, arguments, a `Set`, a text
//   how it is read   `for of`, by index, by a pattern, returned once or twice, in a field, in a variable of the file, in a closure, behind an `await`
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const typed = random.chance(0.25);
  const waits = random.chance(0.2);
  const lines: string[] = [];
  const calls: string[] = [];
  const fractions = random.shuffled([
    "1.5",
    "3.75",
    "9.5",
    "0.25",
    "-2.5",
    "7.125",
    "1e300",
    "4294967296.5",
    "2147483648",
    "-0",
    "NaN",
  ]);
  const others = random.shuffled([
    '"7"',
    '"x"',
    "true",
    "null",
    "undefined",
    "[3]",
    "{ valueOf: () => 6.5 }",
    "Infinity",
  ]);
  const count = random.pick([1, 1, 2, 3]);
  for (let at = 0; at < count; at++) {
    const any = typed ? ": any" : "";
    const declared = typed ? random.pick(["number", "number", "number", "string", "boolean"]) : "";
    const T = typed ? `: ${declared}` : "";
    const given = typed
      ? declared === "number"
        ? random.pick([fractions[at], others[at], others[at]])
        : random.pick([fractions[at], fractions[at], others[at]])
      : random.weighted([
          [4, fractions[at]],
          [1, others[at]],
        ]);
    const handed = typed ? `(${given} as any)` : given;
    const store =
      typed && declared !== "number"
        ? declared === "string"
          ? random.pick(['n += ""', "n = n + n", "n = String(n)", "n = `${n}`"])
          : random.pick(["n = !n", "n = !!n", "n &&= true", "n ||= false"])
        : random.pick([
            "n |= 0",
            "n |= 0",
            "n ^= 0",
            "n &= -1",
            "n <<= 0",
            "n >>= 0",
            "n >>>= 0",
            "n |= 1",
            "n++",
            "n--",
            "n *= 2",
            "n += 1",
            "n = ~n",
            "n = +n",
            "n = n | 0",
            "n ||= 0",
            "n ??= 0",
            "n %= 4",
          ]);
    const who = random.pick(["spot", "spot", "spot", "arrow", "function", "method", "getter"]);
    const change = {
      spot: `(() => ${store.includes("=") && !/^n(\+\+|--)$/.test(store) ? `(${store})` : store})()`,
      arrow: `change${at}()`,
      function: `alter${at}()`,
      method: `holder${at}.change()`,
      getter: `holder${at}.changed`,
    }[who]!;
    const helper = {
      spot: "",
      arrow: `const change${at} = () => ${/^n(\+\+|--)$/.test(store) ? store : `(${store})`};`,
      function: `function alter${at}() {\nreturn ${/^n(\+\+|--)$/.test(store) ? store : `(${store})`};\n}`,
      method: `const holder${at} = {\nchange() {\nreturn ${/^n(\+\+|--)$/.test(store) ? store : `(${store})`};\n},\n};`,
      getter: `const holder${at} = {\nget changed() {\nreturn ${/^n(\+\+|--)$/.test(store) ? store : `(${store})`};\n},\n};`,
    }[who]!;
    const when = random.pick(["between", "between", "between", "between", "behind", "ahead", "never"]);
    const C =
      when === "between" ? (waits && random.chance(0.5) ? `await ${change}` : change) : random.pick(["0", "1", "2.5"]);
    const shape = random.pick([
      "list",
      "list",
      "list",
      "list",
      "longer",
      "hole",
      "nested",
      "spread",
      "of",
      "new",
      "floats",
      "ints",
      "object",
      "arguments",
      "set",
      "text",
      "two",
    ]);
    const made = {
      list: `[n, ${C}, n]`,
      longer: `[1, n, ${C}, n, 2]`,
      hole: `[n, , ${C}, n]`,
      nested: `[[n], ${C}, [n]]`,
      spread: `[...[n], ${C}, n]`,
      of: `Array.of${typed ? "<any>" : ""}(n, ${C}, n)`,
      new: `new Array${typed ? "<any>" : ""}(n, ${C}, n)`,
      floats: `Float64Array.of(n${typed ? " as any" : ""}, ${C}${typed ? " as any" : ""}, n${typed ? " as any" : ""})`,
      ints: `new Int32Array([n, ${C}, n]${typed ? " as any" : ""})`,
      object: `{ a${at}: n, b${at}: ${C}, c${at}: n }`,
      arguments: `((a${any}, b${any}, c${any}) => [a, b, c])(n, ${C}, n)`,
      set: `new Set${typed ? "<any>" : ""}([n, ${C}, n])`,
      text: "`${n} ${" + C + "} ${n}`",
      two: `[n, n]`,
    }[shape]!;
    const walks = shape !== "object" && shape !== "text";
    const byIndex = walks && shape !== "set";
    const read = random.pick([
      walks ? "for (const e of made) console.log(e);" : "console.log(made);",
      walks ? "for (const e of made) console.log(e);" : "console.log(made);",
      byIndex ? "console.log(made[0]);\nconsole.log(made[1]);\nconsole.log(made[2]);" : "console.log(made);",
      byIndex ? "console.log(made[0], made[2], made.length);" : "console.log(made);",
      walks ? "const [a, b, c] = made;\nconsole.log(a);\nconsole.log(b);\nconsole.log(c);" : "console.log(made);",
      byIndex ? `console.log(made[2]${typed ? " as any" : ""} + 1, typeof made[0]);` : "console.log(typeof made);",
      byIndex ? "for (let i = 0; i < made.length; i++) console.log(made[i]);" : "console.log(made);",
      "console.log(made);",
    ]);
    const variable = random.pick([
      "parameter",
      "parameter",
      "parameter",
      "parameter",
      "default",
      "pattern",
      "rest",
      "let",
      "var",
      "for of",
      "catch",
    ]);
    const parameters = {
      parameter: `n${T}`,
      default: `n${T} = ${typed ? `0 as any` : "0"}`,
      pattern: `{ n }${typed ? `: { n${T} }` : ""}`,
      rest: `...all${typed ? `: ${declared}[]` : ""}`,
      let: `given${T}`,
      var: `given${T}`,
      "for of": `given${T}`,
      catch: `given${T}`,
    }[variable]!;
    const argument = variable === "pattern" ? `{ n: ${handed} }` : handed;
    const open = {
      parameter: "",
      default: "",
      pattern: "",
      rest: "let [n] = all;",
      let: "let n = given;",
      var: "var n = given;",
      "for of": "for (let n of [given]) {",
      catch: `try {\nthrow given;\n} catch (n${any}) {`,
    }[variable]!;
    const close = variable === "for of" || variable === "catch" ? "}" : "";
    const A = waits ? "async " : "";
    const W = waits ? "await " : "";
    const road =
      variable === "for of" || variable === "catch"
        ? "here"
        : random.pick(["here", "here", "here", "returned", "twice", "field", "file", "closure"]);
    const ahead = when === "ahead" ? `${change};` : "";
    const behind =
      when === "behind" ? `${change};` : when === "never" ? `if (process.argv.length > 99) ${change};` : "";
    const inner = [open, helper, ahead];
    if (road === "here") {
      lines.push(
        `${A}function f${at}(${parameters}) {`,
        ...inner,
        `const made = ${made};`,
        behind,
        read,
        "console.log(n);",
        close,
        "}",
      );
      calls.push(`${W}f${at}(${argument});`);
    } else if (road === "returned" || road === "twice") {
      lines.push(
        `${A}function f${at}(${parameters}) {`,
        ...inner,
        behind ? `const made = ${made};\n${behind}\nreturn made;` : `return ${made};`,
        "}",
      );
      if (road === "twice") lines.push(`${A}function through${at}(x${any}) {\nreturn ${W}f${at}(x);\n}`);
      calls.push(`{\nconst made = ${W}${road === "twice" ? "through" : "f"}${at}(${argument});\n${read}\n}`);
    } else if (road === "field") {
      lines.push(
        `const kept${at}${typed ? ": any" : ""} = { made${at}: null };`,
        `${A}function f${at}(${parameters}) {`,
        ...inner,
        `kept${at}.made${at} = ${made};`,
        behind,
        "}",
      );
      calls.push(`{\n${W}f${at}(${argument});\nconst made = kept${at}.made${at};\n${read}\n}`);
    } else if (road === "file") {
      lines.push(
        `let file${at}${any};`,
        `${A}function f${at}(${parameters}) {`,
        ...inner,
        `file${at} = ${made};`,
        behind,
        "}",
      );
      calls.push(`{\n${W}f${at}(${argument});\nconst made = file${at};\n${read}\n}`);
    } else {
      lines.push(
        `${A}function f${at}(${parameters}) {`,
        ...inner,
        `const made = ${made};`,
        behind,
        `return () => {\n${read}\nconsole.log(n);\n};`,
        "}",
      );
      calls.push(`(${W}f${at}(${argument}))();`);
    }
  }
  const text = [...lines, ...calls].filter(Boolean).join("\n") + "\n";
  return {
    file: typed ? "main.ts" : waits ? "main.mjs" : random.pick(["main.js", "main.mjs", "main.cjs"]),
    text: typed ? text + "export {};\n" : text,
  };
}
