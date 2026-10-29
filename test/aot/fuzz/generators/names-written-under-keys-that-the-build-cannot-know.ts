// The compiler knows what many names hold: a method of a class, a member of a function, an export. Each program here writes such a name under a key that is put together at run time.

const first = 'function () { return "first"; }';

type Target = { declared: string; object: string; name: string; use: string; extension: string; files?: Record<string, string> };

export const targets: Record<string, Target> = {
  "own member of a function": { declared: `function F() {}\nF.helper = ${first};`, object: "F", name: "helper", use: "F.helper()", extension: "js" },
  "static method of a class": { declared: 'class C { static helper() { return "first"; } }', object: "C", name: "helper", use: "C.helper()", extension: "js" },
  "static field of a class": { declared: `class C { static helper = ${first}; }`, object: "C", name: "helper", use: "C.helper()", extension: "js" },
  "method of a class": { declared: 'class C { helper() { return "first"; } }', object: "C.prototype", name: "helper", use: "new C().helper()", extension: "js" },
  "method of the class above": { declared: 'class B { helper() { return "first"; } }\nclass C extends B {}', object: "B.prototype", name: "helper", use: "new C().helper()", extension: "js" },
  "method hidden in the class below": { declared: 'class B { helper() { return "first"; } }\nclass C extends B {}', object: "C.prototype", name: "helper", use: "new C().helper()", extension: "js" },
  "method of a constructor function": { declared: `function Q() {}\nQ.prototype.helper = ${first};`, object: "Q.prototype", name: "helper", use: "new Q().helper()", extension: "js" },
  "prototype of a constructor function": { declared: `function Q() {}\nQ.prototype.helper = ${first};`, object: "Q", name: "prototype", use: "new Q().helper()", extension: "js" },
  "method of a literal": { declared: 'const o = { helper() { return "first"; } };', object: "o", name: "helper", use: "o.helper()", extension: "js" },
  "method hidden on an instance": { declared: 'class C { helper() { return "first"; } }\nconst kept = new C();', object: "kept", name: "helper", use: "kept.helper()", extension: "js" },
  "getter of a class": { declared: 'class C { get helper() { return () => "first"; } }', object: "C.prototype", name: "helper", use: "new C().helper()", extension: "js" },
  "member of exports": { declared: `exports.helper = ${first};`, object: "module.exports", name: "helper", use: "exports.helper()", extension: "cjs" },
  "member of a required file": { declared: 'const lib = require("./lib.cjs");', object: "lib", name: "helper", use: "lib.helper()", extension: "cjs", files: { "lib.cjs": `exports.helper = ${first};\n` } },
  "member of an imported CommonJS file": { declared: 'import lib from "./lib.cjs";', object: "lib", name: "helper", use: "lib.helper()", extension: "mjs", files: { "lib.cjs": `exports.helper = ${first};\n` } },
  "export seen through a namespace": { declared: 'import * as lib from "./lib.mjs";', object: "lib", name: "helper", use: "lib.helper()", extension: "mjs", files: { "lib.mjs": 'export function helper() { return "first"; }\n' } },
  "member of a TypeScript namespace": { declared: 'namespace N { export function helper() { return "first"; } }', object: "N", name: "helper", use: "N.helper()", extension: "ts" },
  "member of an enum": { declared: "enum E { helper = 1 }", object: "E", name: "helper", use: "String(E.helper)", extension: "ts" },
};

/** «o» is the object, «v» the value. */
export const writes: Record<string, string> = {
  "a computed key": "«o»[key] = «v»;",
  "Reflect.set": "Reflect.set(«o», key, «v»);",
  "Object.assign": "Object.assign(«o», { [key]: «v» });",
  "Object.defineProperty": "Object.defineProperty(«o», key, { value: «v», writable: true, configurable: true });",
  "Object.defineProperties": "Object.defineProperties(«o», { [key]: { value: «v», writable: true, configurable: true } });",
  "Reflect.defineProperty": "Reflect.defineProperty(«o», key, { value: «v», writable: true, configurable: true });",
  "a function that stores": "put(«o», key, «v»);",
  "a loop over the keys of another object": "for (const name of Object.keys({ [key]: 0 })) «o»[name] = «v»;",
  "a callback over entries": "Object.entries({ [key]: «v» }).forEach(([name, value]) => { «o»[name] = value; });",
  "a proxy": "new Proxy(«o», {})[key] = «v»;",
  "a getter": "Object.defineProperty(«o», key, { get() { return «v»; }, configurable: true });",
  "delete": "delete «o»[key];",
  "Reflect.deleteProperty": "Reflect.deleteProperty(«o», key);",
};

export const moments = ["before the first use", "between two uses in one function", "after many uses"] as const;

/** Every Bun refuses to build a store to, or a delete from, a name that an import declares. */
export const isRefusedByEveryBuild = (target: string, write: string) =>
  targets[target].declared.startsWith("import * as") && /«o»\[/.test(writes[write]) && !writes[write].startsWith("new Proxy");

export function program(target: string, write: string, moment: (typeof moments)[number]) {
  const { declared, object, name, use, extension, files } = targets[target];
  const isTyped = extension === "ts";
  const any = isTyped ? " as any" : "";
  const written = isTyped ? `(${object} as any)` : object;
  const other = name === "prototype" ? '{ helper() { return "second"; } }' : 'function () { return "second"; }';
  const attempt = (statement: string) => `try { ${statement} } catch (error) { log.push((error${any}).constructor.name); }`;
  const store = attempt(writes[write].replaceAll("«o»", written).replaceAll("«v»", "other"));
  const restore = attempt(`Object.defineProperty(${written}, "${name}", { value: original, writable: true, configurable: true });`);
  const head = [
    `const key${isTyped ? ": string" : ""} = process.argv.length > 100 ? "x" : ["${name.slice(0, 3)}", "${name.slice(3)}"].join("");`,
    isTyped ? "function put(o: any, k: string, v: any) { o[k] = v; }" : "function put(o, k, v) { o[k] = v; }",
    declared,
    `const original = ${written}["${name}"];`,
    `const other${isTyped ? ": any" : ""} = ${other};`,
    `const log${isTyped ? ": string[]" : ""} = [];`,
    `function ask() { try { return String(${use}); } catch (error) { return (error${any}).constructor.name; } }`,
  ];
  const rest = {
    "before the first use": [store, "for (let i = 0; i < 3; i++) log.push(ask());", 'console.log(log.join(" "));'],
    "between two uses in one function": [
      `function run() { const a = ask(); ${store} const b = ask(); ${restore} return a + " " + b; }`,
      "for (let i = 0; i < 3; i++) log.push(run());",
      'console.log(log.join(" | "));',
    ],
    "after many uses": ["for (let i = 0; i < 200; i++) ask();", "log.push(ask());", store, "log.push(ask());", 'console.log(log.join(" "));'],
  }[moment];
  return { file: `main.${extension}`, text: [...head, ...rest, ...(isTyped ? ["export {};"] : [])].join("\n") + "\n", files };
}
