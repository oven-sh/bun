// A program checks which runtime it runs on, as libraries do, and branches. A build may fold the check and drop the
// other branch. The decision must follow bindings, not identifier text: a local named `Bun` is not the global.
import type { Random } from "./random";

const asked: [test: string, names: string[]][] = [
  [`typeof Bun !== "undefined"`, ["Bun"]],
  [`typeof Bun != "undefined"`, ["Bun"]],
  [`"undefined" !== typeof Bun`, ["Bun"]],
  [`typeof Bun === "object"`, ["Bun"]],
  [`typeof Bun === "undefined"`, ["Bun"]],
  [`typeof Bun == "undefined"`, ["Bun"]],
  [`globalThis.Bun`, ["globalThis"]],
  [`!globalThis.Bun`, ["globalThis"]],
  [`globalThis.Bun !== undefined`, ["globalThis", "undefined"]],
  [`globalThis.Bun != null`, ["globalThis"]],
  [`globalThis.Bun === void 0`, ["globalThis"]],
  [`typeof globalThis.Bun !== "undefined"`, ["globalThis"]],
  [`"Bun" in globalThis`, ["globalThis"]],
  [`!("Bun" in globalThis)`, ["globalThis"]],
  [`globalThis?.Bun`, ["globalThis"]],
  [`globalThis?.Bun?.version`, ["globalThis"]],
  [`typeof globalThis?.Bun?.version === "string"`, ["globalThis"]],
  [`typeof Bun !== "undefined" && typeof Bun.version === "string"`, ["Bun"]],
  [`typeof Bun === "undefined" || !Bun.version`, ["Bun"]],
  [`typeof Bun !== "undefined" && "version" in Bun`, ["Bun"]],
  [`globalThis.Bun ?? false`, ["globalThis"]],
  [`process.versions.bun`, ["process"]],
  [`typeof process.versions.bun === "string"`, ["process"]],
  [`"bun" in process.versions`, ["process"]],
  [`typeof process !== "undefined"`, ["process"]],
  [`typeof process === "object" && !!process.versions?.bun`, ["process"]],
  [`typeof require === "function"`, ["require"]],
  [`typeof Deno === "undefined"`, ["Deno"]],
  [`typeof Deno !== "undefined"`, ["Deno"]],
  [`typeof window === "undefined"`, ["window"]],
  [`typeof window !== "undefined" && typeof window.document !== "undefined"`, ["window"]],
  [`typeof Bun === "undefined" ? false : true`, ["Bun"]],
  [`typeof Bun !== "undefined" || typeof Deno !== "undefined"`, ["Bun", "Deno"]],
];

// What a binding of the program's own may be.
const own = [`undefined`, `null`, `0`, `{}`, `{ version: 7 }`, `{ Bun: undefined }`, `{ versions: {} }`, `{ versions: { bun: "" } }`, `"text"`, `() => 1`, `{ Bun: { version: "own" }, versions: { bun: "own" }, version: "own" }`];

function scene(random: Random, index: number): string {
  const [test, names] = random.pick(asked);
  const name = random.pick(names);
  const value = random.pick(own);
  const yes = `console.log(${index}, "yes")`;
  const no = random.chance(0.25) ? `console.log(${index}, "no", require("./not-there-${index}.js"))` : `console.log(${index}, "no")`;
  const arms = (held: string) =>
    random.pick([`if (${held}) ${yes};\nelse ${no};`, `if (!(${held})) ${no};\nelse ${yes};`, `${held} ? ${yes} : ${no};`, `(${held}) && ${yes};\n(${held}) || ${no};`, `console.log(${index}, "is", typeof (${held}), !!(${held}));`, `switch (!!(${held})) {\n  case true:\n    ${yes};\n    break;\n  default:\n    ${no};\n}`]);
  const safely = (text: string) => `try {\n${text}\n} catch (error) {\n  console.log(${index}, "throws", error.constructor.name);\n}`;
  const held = `is${index}`;
  const holder = random.weighted([
    [4, () => arms(test)],
    [2, () => `const ${held} = ${test};\n${arms(held)}`],
    [2, () => `let ${held} = ${test};\n${arms(held)}`],
    [2, () => `var ${held} = ${test};\n${arms(held)}`],
    [2, () => `early${index}();\nvar ${held} = ${test};\nearly${index}();\nfunction early${index}() {\n${arms(held)}\n}`],
    [2, () => `${safely(`early${index}();`)}\n${random.pick(["let", "const"])} ${held} = ${test};\nearly${index}();\nfunction early${index}() {\n${arms(held)}\n}`],
    [1, () => `let ${held} = ${test};\nconst later${index} = () => {\n${arms(held)}\n};\nlater${index}();\n${held} = !${held};\nlater${index}();`],
    [1, () => `let ${held} = ${test};\nfunction flip${index}() {\n  ${held} = !${held};\n}\n${arms(held)}\n${random.chance(0.5) ? `flip${index}();` : `if (process.argv.length > 90) flip${index}();`}\n${arms(held)}`],
    [1, () => `var ${held} = ${test};\nfor (let turn = 0; turn < 4; turn++) {\n  if (turn === 2) ${held} = !${held};\n${arms(held)}\n}`],
    [1, () => `var ${held};\n${arms(held)}\n${held} = ${test};\n${arms(held)}`],
    [1, () => `let ${held};\nif (process.argv.length < 90) ${held} = ${test};\n${arms(held)}`],
    [1, () => `const { ${held} } = { ${held}: ${test} };\n${arms(held)}`],
    [1, () => `const holds${index} = { ${held}: ${test} };\n${arms(`holds${index}.${held}`)}\nholds${index}.${held} = !holds${index}.${held};\n${arms(`holds${index}.${held}`)}`],
    [1, () => `function asks${index}(${held} = ${test}) {\n${arms(held)}\n}\nasks${index}();\nasks${index}(0);\nasks${index}(1);`],
    [1, () => `var ${held} = ${test};\nvar ${held};\n${arms(held)}\nvar ${held} = 0;\n${arms(held)}`],
    [1, () => `let ${held} = ${test};\n${held} &&= 0;\n${arms(held)}`],
    [1, () => `let ${held} = ${test};\n[${held}] = [!${held}];\n${arms(held)}`],
  ] as const)();
  const bound = random.weighted([
    [5, () => `{\n${holder}\n}`],
    [2, () => `(function (${name}) {\n${holder}\n})(${value});`],
    [2, () => `(function () {\n  const ${name} = ${value};\n${holder}\n})();`],
    [1, () => `(function () {\n${safely(holder)}\n  var ${name} = ${value};\n})();`],
    [1, () => `(function () {\n${safely(holder)}\n  let ${name} = ${value};\n})();`],
    [1, () => `(function () {\n  function ${name}() {}\n${holder}\n})();`],
    [1, () => `(function () {\n  class ${name} {\n    static version = "class";\n    static Bun = 1;\n    static versions = {};\n  }\n${holder}\n})();`],
    [1, () => `try {\n  throw ${value};\n} catch (${name}) {\n${holder}\n}`],
    [1, () => `(function () {\n  {\n    const ${name} = ${value};\n    void ${name};\n  }\n${holder}\n})();`],
    [1, () => `(function () {\n  const inner = ${name} => ${name};\n  void inner;\n${holder}\n})();`],
    [1, () => `(function () {\n  const { ${name} } = { ${name}: ${value} };\n${holder}\n})();`],
    [1, () => `(function ({ ${name} = ${value} } = {}) {\n${holder}\n})();`],
    [1, () => `for (const ${name} of [${value}, ${random.pick(own)}]) {\n${safely(arms(test))}\n}`],
  ] as const)();
  return safely(name === "undefined" || name === "require" ? `{\n${holder}\n}` : bound);
}

const stores = [`globalThis.Bun = 1;`, `delete globalThis.Bun;`, `Object.defineProperty(globalThis, "Bun", { value: 1 });`, `Reflect.set(globalThis, "Bun", 1);`, `Reflect.deleteProperty(globalThis, "Bun");`, `globalThis.Deno = {};`, `globalThis.window = { document: {} };`];

export function generate(random: Random): string {
  const scenes = Array.from({ length: random.between(3, 9) }, (_, index) => scene(random, index));
  if (random.chance(0.3)) scenes.splice(random.below(scenes.length), 0, `try {\n  console.log("stored", (() => {\n    ${random.pick(stores)}\n    return typeof Bun + typeof globalThis.Deno + typeof globalThis.window;\n  })());\n} catch (error) {\n  console.log("store throws", error.constructor.name);\n}`);
  return scenes.join("\n") + "\n";
}
