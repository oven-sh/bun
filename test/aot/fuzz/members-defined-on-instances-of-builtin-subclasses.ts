// An instance of a class that extends a built-in class is an object of the built-in class. The class may declare fields,
// private names, accessors and methods all the same, and the program adds members to the instance: by Object.defineProperty
// with a descriptor written in place, by a store, by Object.assign. Each scene makes many such objects in a loop, so that what
// depends on where an object lies may show within one run, and keeps the compiler's sight of them: the object is made, changed
// and read in one function, without a helper that every scene shares. It counts what the setters and getters saw.
import type { Random } from "./random";

const parents: [name: string, args: string][] = [
  ["Array", ""],
  ["Array", ""],
  ["Array", ""],
  ["Array", ""],
  ["Array", "3"],
  ["Map", ""],
  ["Map", ""],
  ["Map", ""],
  ["Set", ""],
  ["Error", '"e"'],
  ["Promise", "() => {}"],
  ["RegExp", '"a"'],
  ["Date", "0"],
  ["Uint8Array", "2"],
  ["ArrayBuffer", "8"],
  ["Function", ""],
  ["Number", "5"],
  ["String", '"text"'],
  ["Object", ""],
  ["Event", '"e"'],
  ["URL", '"http://a/"'],
  ["EventTarget", ""],
];

/** Members of the class. */
const members = [
  "#p = 5;\n    m() {\n      return this.#p;\n    }",
  "#p = 5;\n    m() {\n      return this.#p;\n    }",
  "#p = 5;\n    #q = 6;\n    m() {\n      return this.#p + this.#q;\n    }",
  "f = 5;\n    m() {\n      return this.f;\n    }",
  "#p = 5;\n    f = 6;\n    m() {\n      return this.#p + this.f;\n    }",
  "m() {\n      return 5;\n    }",
  "static #s = 5;\n    m() {\n      return C.#s;\n    }",
  "#p() {\n      return 5;\n    }\n    m() {\n      return this.#p();\n    }",
  "get #p() {\n      return 5;\n    }\n    m() {\n      return this.#p;\n    }",
  "#p = 5;\n    m() {\n      return this.#p++;\n    }",
];

/** Statements that add a member `c` to `o`. */
const additions = [
  'Object.defineProperty(o, "c", {\n        set(x) {\n          hits++;\n        },\n        configurable: true,\n      });',
  'Object.defineProperty(o, "c", {\n        set(x) {\n          hits++;\n        },\n        configurable: true,\n      });',
  'Object.defineProperty(o, "c", {\n        get() {\n          hits++;\n          return 7;\n        },\n        configurable: true,\n      });',
  'Object.defineProperty(o, "c", {\n        get() {\n          hits++;\n          return 7;\n        },\n        set(x) {\n          hits += 10;\n        },\n        enumerable: true,\n      });',
  'Object.defineProperty(o, "c", { value: i, writable: true, enumerable: true, configurable: true });',
  'Object.defineProperty(o, "c", { value: i });',
  'Object.defineProperty(o, "c", { value: i, writable: false, enumerable: true });',
  "Object.defineProperties(o, {\n        c: {\n          set(x) {\n            hits++;\n          },\n        },\n        d: { value: i },\n      });",
  'Reflect.defineProperty(o, "c", {\n        set(x) {\n          hits++;\n        },\n      });',
  "o.c = i;",
  "Object.assign(o, { c: i, d: 1 });",
  'o.__defineSetter__("c", x => {\n        hits++;\n      });',
  "o.a = 1;\n      o.b = 2;\n      o.c = i;",
];

/** Statements that use `o` afterwards and add to `sum` or `seen`. */
const uses = [
  "o.c = 1;",
  "o.c = 1;",
  "sum += o.c === undefined ? 1 : 2;",
  'o.c = 1;\n      sum += typeof o.c === "number" ? o.c : 100;',
  "sum += o.m();",
  "seen.add(Object.keys(o).join());",
  'seen.add(JSON.stringify(Object.getOwnPropertyDescriptor(o, "c")));',
  'sum += "c" in o ? 1 : 0;',
  'delete o.c;\n      sum += "c" in o ? 1 : 0;',
  "o.d = i;\n      sum += o.d;",
  "o[0] = i;\n      sum += o[0] === i ? 1 : 0;",
  "sum += o.length ?? o.size ?? 0;",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const [parent, args] = random.pick(parents);
    const isKept = random.chance(0.4);
    // Mostly the class stands at the top of the file, where it is evaluated once and the compiler knows its instances best.
    // Private fields and accessors written in place are drawn more often than the rest.
    const written = `class C extends ${parent} {\n    ${random.pick(random.chance(0.5) ? members.slice(0, 3) : members)}\n  }`;
    const isInside = random.chance(0.15);
    const body = `const o = new C(${args});
      ${random.chance(0.7) ? "sum += o.m();" : ""}
      ${random.pick(random.chance(0.4) ? additions.slice(0, 4) : additions)}
      ${random.sample(uses, random.between(1, 3)).join("\n      ")}
      ${isKept ? "all.push(o);" : ""}`;
    // Mostly a function makes one object and is called again and again. Code in a loop is compiled in another way.
    const isInLoop = isInside || random.chance(0.25);
    const text = `${isInside ? "" : written}
${isInLoop ? "" : `function one${scene}(i) {\n      ${body}\n}`}
function scene${scene}() {
  ${isInside ? written : ""}
  hits = 0;
  sum = 0;
  let thrown = 0;
  for (let i = 0; i < ${random.pick([1, 3, 40, 200])}; i++) {
    try {
      ${isInLoop ? body : `one${scene}(i);`}
    } catch (error) {
      thrown++;
      seen.add(error.name);
    }
  }
  ${isKept ? 'Bun.gc(true);\n  for (const o of all.splice(0)) sum += o.m() + ("c" in o ? 1 : 0);' : ""}
  return [hits, sum, thrown, [...seen].join(" ")].join(" | ");
}
console.log("scene ${scene}", scene${scene}());
seen.clear();`;
    scenes.push(text.replace(/\bC\b/g, `C${scene}`));
  }
  return "let hits = 0;\nlet sum = 0;\nconst seen = new Set();\nconst all = [];\n" + scenes.join("\n") + "\n";
}
