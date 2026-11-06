// Small programs in which an object of the program declares a member, code of the program reads it, and a built-in that is handed the object writes a member of that very name by itself: the name
// stands nowhere in the call. The member is read before and behind the call, by the same function.
//
//   the built-in   `Error.captureStackTrace` (stack), methods of `Array.prototype` called on an object (length and indexes), `Array.from` and `Array.of` called on a constructor of the program (length and
//                  indexes), the symbol methods of `RegExp.prototype` called on an object (lastIndex), `EventEmitter.call` (_events, _eventsCount, _maxListeners), `util.inherits` (super_)
//   called         by its name, through a constant, `call`, `apply`, `Reflect.apply`, `bind`, as the callback of `forEach`
//   the object     a class with a static field, a literal, an instance with a field, `this` inside a constructor, a function with a member, an object that inherits the member, one with an accessor
//                  under the name, one that is frozen, sealed or has the member read-only
//   the read       `typeof`, the value where every run gives the same one, the descriptor, the own keys; in a method, a closure or a loop
import type { Random } from "./random";

type Writer = {
  name: string;
  // Expressions that call the built-in on `H`; `F` stands for the way the built-in itself is reached.
  reach: string;
  rest: string;
  // Whether the value that is written is the same in every run.
  isSteady: boolean;
  needs?: string;
  // More members the object needs for the built-in to get as far as its write.
  more?: string[];
  onlyFunctions?: boolean;
};

const writers: readonly Writer[] = [
  { name: "stack", reach: "Error.captureStackTrace", rest: "", isSteady: false },
  { name: "stack", reach: "Error.captureStackTrace", rest: ", function () {}", isSteady: false },
  { name: "length", reach: "Array.prototype.push", rest: ", 7", isSteady: true },
  { name: "length", reach: "Array.prototype.push", rest: "", isSteady: true },
  { name: "length", reach: "Array.prototype.pop", rest: "", isSteady: true },
  { name: "length", reach: "Array.prototype.shift", rest: "", isSteady: true },
  { name: "length", reach: "Array.prototype.unshift", rest: `, "first"`, isSteady: true },
  { name: "length", reach: "Array.prototype.splice", rest: ", 0, 0, 1, 2", isSteady: true },
  { name: "0", reach: "Array.prototype.push", rest: `, "pushed"`, isSteady: true },
  { name: "0", reach: "Array.prototype.fill", rest: ", 2.5", isSteady: true, more: ["length: 2"] },
  { name: "0", reach: "Array.prototype.reverse", rest: "", isSteady: true, more: ["length: 2", `1: "last"`] },
  { name: "0", reach: "Array.prototype.sort", rest: "", isSteady: true, more: ["length: 2", "1: -4"] },
  {
    name: "0",
    reach: "Array.prototype.copyWithin",
    rest: ", 0, 1",
    isSteady: true,
    more: ["length: 2", `1: "copied"`],
  },
  {
    name: "lastIndex",
    reach: "RegExp.prototype[Symbol.match]",
    rest: `, "text"`,
    isSteady: true,
    more: [`flags: "g"`, "exec: () => null"],
  },
  {
    name: "lastIndex",
    reach: "RegExp.prototype[Symbol.replace]",
    rest: `, "text", ""`,
    isSteady: true,
    more: [`flags: "g"`, "exec: () => null"],
  },
  {
    name: "lastIndex",
    reach: "RegExp.prototype[Symbol.search]",
    rest: `, "text"`,
    isSteady: true,
    more: ["exec: () => null"],
  },
  {
    name: "_events",
    reach: "EventEmitter",
    rest: "",
    isSteady: false,
    needs: `import { EventEmitter } from "node:events";`,
  },
  {
    name: "_eventsCount",
    reach: "EventEmitter",
    rest: "",
    isSteady: true,
    needs: `import { EventEmitter } from "node:events";`,
  },
  {
    name: "_maxListeners",
    reach: "EventEmitter",
    rest: "",
    isSteady: true,
    needs: `import { EventEmitter } from "node:events";`,
  },
  {
    name: "super_",
    reach: "inherits",
    rest: ", function Above() {}",
    isSteady: false,
    needs: `import { inherits } from "node:util";`,
    onlyFunctions: true,
  },
];

// Those whose receiver is `this`; the others take the object as their first argument.
const takesThis = (writer: Writer) => /prototype|EventEmitter/.test(writer.reach);

export function generate(random: Random): { file: string; text: string } {
  const isTyped = random.chance(0.3);
  const any = isTyped ? " as any" : "";
  const imports = new Set<string>();
  const lines: string[] = [];
  const count = random.between(1, 3);
  for (let at = 0; at < count; at++) {
    const writer = random.pick(writers);
    if (writer.needs) imports.add(writer.needs);
    const name = writer.name;
    const isIndex = /^\d+$/.test(name);
    const member = isIndex ? `[${name}]` : `.${name}`;
    const first = random.pick(["1", "2.5", `"before"`, "null", "true", "undefined", "[1]", "{ a: 1 }"]);
    const type = isTyped
      ? ": " +
        (first === "1" || first === "2.5"
          ? "number"
          : first === `"before"`
            ? "string"
            : first === "true"
              ? "boolean"
              : "any")
      : "";
    const more = writer.more ?? [];
    const kind = writer.onlyFunctions
      ? random.pick(["class", "function"] as const)
      : random.weighted([
          [5, "class"],
          [3, "literal"],
          [3, "instance"],
          [2, "this"],
          [2, "function"],
          [1, "inherits"],
          [1, "accessor"],
          [1, "frozen"],
          [1, "sealed"],
          [1, "read-only"],
        ] as const);
    const H = `H${at}`;
    const key = isIndex ? name : name;
    const asStatic = (text: string) => `static ${text.replace(/^(\w+): /, "$1 = ")};`;
    const asField = (text: string) => `${text.replace(/^(\w+): /, "$1 = ")};`;
    const target = kind === "this" ? "this" : H;
    const reached = random.weighted([
      [5, "name"],
      [1, "constant"],
      [1, "Reflect.apply"],
      [1, "bind"],
      [1, "forEach"],
      [1, "apply"],
    ] as const);
    const f = `(${writer.reach}${any})`;
    const rest = writer.rest;
    const list = rest ? rest.slice(2) : "";
    const call = takesThis(writer)
      ? reached === "Reflect.apply"
        ? `Reflect.apply(${f}, ${target}, [${list}]);`
        : reached === "bind"
          ? `${f}.bind(${target})(${list});`
          : reached === "apply"
            ? `${f}.apply(${target}, [${list}]);`
            : reached === "constant"
              ? `const reached${at} = ${f};\nreached${at}.call(${target}${rest});`
              : `${f}.call(${target}${rest});`
      : reached === "Reflect.apply"
        ? `Reflect.apply(${f}, undefined, [${target}${rest}]);`
        : reached === "bind"
          ? `${f}.bind(undefined, ${target})(${list});`
          : reached === "apply"
            ? `${f}.apply(undefined, [${target}${rest}]);`
            : reached === "constant"
              ? `const reached${at} = ${f};\nreached${at}(${target}${rest});`
              : reached === "forEach" && !rest
                ? `[${target}].forEach(${f});`
                : `${f}(${target}${rest});`;
    const guarded = `try {\n${call}\n} catch (error) {\nconsole.log("${at} throws", (error${any}).constructor.name);\n}`;
    const value = (holder: string) =>
      writer.isSteady ? `JSON.stringify(${holder}${member})` : `typeof ${holder}${member}`;
    const self = isTyped ? `(${H} as any)` : H;
    if (kind === "class") {
      lines.push(
        `class ${H} {\nstatic ${key}${type} = ${first};\n${more.map(asStatic).join("\n")}\nstatic read() {\nreturn typeof ${H}${member} + " " + ${value(H)};\n}\n}`,
      );
    } else if (kind === "function") {
      const laid = (text: string) =>
        `Object.defineProperty(${H}, ${JSON.stringify(text.slice(0, text.indexOf(": ")))}, { value: ${text.slice(text.indexOf(": ") + 2)}, writable: true, enumerable: true, configurable: true });`;
      lines.push(
        `function ${H}() {}\n${[`${key}: ${first}`, ...more].map(laid).join("\n")}\n${self}.read = () => typeof ${self}${member} + " " + ${value(self)};`,
      );
    } else if (kind === "instance" || kind === "this") {
      lines.push(
        `class Made${at} {\n${key}${type} = ${first};\n${more.map(asField).join("\n")}\n${kind === "this" ? `constructor() {\nconsole.log("${at} inside", this.read());\n${guarded}\n}\n` : ""}read() {\nreturn typeof this${member} + " " + ${value("this")};\n}\n}\nconst ${H} = new Made${at}();`,
      );
    } else {
      const own = kind === "inherits" ? more : [`${key}: ${first}`, ...more];
      const accessor = `get ${key}() {\nreturn ${first};\n},\nset ${key}(given) {\nconsole.log("${at} the setter gets", typeof given);\n}`;
      const body = kind === "accessor" ? [accessor, ...more] : own;
      lines.push(
        `const ${H}${isTyped ? ": any" : ""} = {\n${kind === "inherits" ? `__proto__: { ${key}: ${first} },\n` : ""}${body.join(",\n")}${body.length ? ",\n" : ""}read() {\nreturn typeof ${H}${member} + " " + ${value(H)};\n},\n};`,
      );
      if (kind === "frozen") lines.push(`Object.freeze(${H});`);
      if (kind === "sealed") lines.push(`Object.seal(${H});`);
      if (kind === "read-only")
        lines.push(`Object.defineProperty(${H}, ${JSON.stringify(name)}, { writable: false });`);
    }
    const isLoop = random.chance(0.3);
    const read = `${self}.read()`;
    lines.push(
      isLoop
        ? `for (let turn = 0; turn < 3; turn++) console.log("${at} before", ${read});`
        : `console.log("${at} before", ${read});`,
    );
    if (kind !== "this") lines.push(guarded);
    lines.push(
      isLoop
        ? `for (let turn = 0; turn < 3; turn++) console.log("${at} behind", ${read});`
        : `console.log("${at} behind", ${read});`,
    );
    lines.push(`console.log("${at} outside", typeof ${self}${member}, Object.hasOwn(${H}, ${JSON.stringify(name)}));`);
    lines.push(
      `console.log("${at} described", (found => found && [typeof found.value, typeof found.get, found.writable, found.enumerable, found.configurable].join())(Object.getOwnPropertyDescriptor(${H}, ${JSON.stringify(name)})));`,
    );
    if (name !== "stack") lines.push(`console.log("${at} keys", Object.keys(${H}).join());`);
  }
  return {
    file: isTyped ? "main.ts" : "main.mjs",
    text: [...imports, ...lines].join("\n").replace(/\n\n+/g, "\n") + "\n",
  };
}
