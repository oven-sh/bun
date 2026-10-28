// Small programs about one function that is handed a class and answers with a class below it, and two or three classes that it makes. Every call evaluates the class anew: the classes are different
// objects with different classes above, their private names are different names, and `super` in each leads to its own class above. There is one scene, and every line is printed at once.
//
//   the function   an arrow, a declared function, with a name for the class or without, two of them laid over each other, one that remembers what it has made
//   the class      fields, a constructor that hands its arguments on, a method that calls `super`, a getter and a setter, static members, a private field, a private method, a static test with `in`
//   handed         two classes of the program with other fields and the same method, the same class twice, `Object`, `Array`, `Map`, `Error`, a function, a class that the function made, a bound
//                  class, a proxy round a class
//   then           instances are made; their keys, JSON, methods, `instanceof`, the names of the classes, the static members; a method of one class on an instance of the other
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const has = {
    field: random.chance(0.7),
    construct: random.chance(0.4),
    hello: random.chance(0.7),
    accessor: random.chance(0.25),
    fixed: random.chance(0.4),
    hidden: random.chance(0.5),
    hiddenMethod: random.chance(0.2),
  };
  const body = [
    has.field ? 'mixed = "mixed";' : "",
    has.hidden ? "#hidden = 1;" : "",
    has.fixed ? "static made = 0;\nstatic count() {\nreturn ++this.made;\n}" : "",
    has.construct ? 'constructor(...given) {\nsuper(...given);\nthis.built = "built " + given.length;\n}' : "",
    has.hello
      ? 'hello() {\nreturn "mixed over " + (typeof super.hello === "function" ? super.hello() : "nothing");\n}'
      : "",
    has.accessor
      ? "get twice() {\nreturn String(this.a ?? this.b ?? this.length) + String(this.a ?? this.b ?? this.length);\n}\nset twice(given) {\nthis.stored = given;\n}"
      : "",
    has.hiddenMethod ? '#secret() {\nreturn "secret";\n}\ntells() {\nreturn this.#secret();\n}' : "",
    has.hidden ? "static has(o) {\nreturn #hidden in o;\n}\nreads() {\nreturn this.#hidden;\n}" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const name = random.pick(["", "", "Mixed "]);
  const mixin = random.pick([
    `const mix = Base =>\nclass ${name}extends Base {\n${body}\n};`,
    `function mix(Base) {\nreturn class ${name}extends Base {\n${body}\n};\n}`,
    `function mix(Base) {\nclass Mixed extends Base {\n${body}\n}\nreturn Mixed;\n}`,
    `const known = new Map();\nfunction mix(Base) {\nif (!known.has(Base))\nknown.set(\nBase,\nclass ${name}extends Base {\n${body}\n},\n);\nreturn known.get(Base);\n}`,
  ]);
  const second = random.chance(0.3)
    ? 'const also = Base =>\nclass extends Base {\nalso = "also";\nhello() {\nreturn "also over " + (typeof super.hello === "function" ? super.hello() : "nothing");\n}\n};'
    : "";
  const bases =
    'class A {\na = 1;\nhello() {\nreturn "A";\n}\n}\nclass B {\nb = "t";\nc = 2.5;\nhello() {\nreturn "B";\n}\n}';
  const handed = () =>
    random.weighted([
      [5, "A"],
      [5, "B"],
      [1, "Object"],
      [2, "Array"],
      [2, "Map"],
      [1, "Error"],
      [1, 'function () {\nthis.f = "of a function";\n}'],
      [2, "mix(A)"],
      [1, "A.bind(null)"],
      [1, "new Proxy(B, {})"],
      ...(second
        ? ([
            [3, "also(A)"],
            [2, "also(B)"],
          ] as [number, string][])
        : []),
    ]);
  const count = random.pick([1, 2, 2, 2, 3]);
  const classes = Array.from(
    { length: count },
    (_, index) => `const K${index} = ${second && random.chance(0.3) ? `also(mix(${handed()}))` : `mix(${handed()})`};`,
  );
  const instances = Array.from({ length: count }, (_, index) => `const o${index} = new K${index}();`);
  const other = (index: number) => (index + 1) % count;
  const attempt = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("refused", error.constructor.name);\n}`;
  const asks = (i: number): string[] => [
    `console.log(Object.keys(o${i}).join());`,
    `console.log(Object.keys(o${i}).join());`,
    `console.log(JSON.stringify(o${i}));`,
    has.hello
      ? `console.log(o${i}.hello());`
      : `console.log(typeof o${i}.hello === "function" ? o${i}.hello() : "no hello");`,
    `console.log(o${i} instanceof K${other(i)}, o${i} instanceof A, o${i} instanceof B);`,
    `console.log(K${i}.name, Object.getPrototypeOf(K${i}).name, K${i} === K${other(i)});`,
    has.fixed
      ? `console.log(K${i}.count(), K${i}.count(), K${other(i)}.made);`
      : `console.log(Object.getOwnPropertyNames(K${i}).join());`,
    has.hidden
      ? `console.log(K${i}.has(o${i}), K${i}.has(o${other(i)}), K${other(i)}.has(o${i}));`
      : `console.log(o${i}.mixed, o${i}.a, o${i}.b);`,
    has.hidden ? `console.log(K${i}.prototype.reads.call(o${other(i)}));` : `console.log(o${i}.constructor === K${i});`,
    has.hello
      ? `console.log(K${i}.prototype.hello.call(o${other(i)}));`
      : `console.log(Object.getPrototypeOf(Object.getPrototypeOf(o${i})) === Object.getPrototypeOf(K${i}).prototype);`,
    has.accessor ? `o${i}.twice = 5;\nconsole.log(o${i}.twice, o${i}.stored);` : `console.log("twice" in o${i});`,
    has.hiddenMethod
      ? `console.log(o${i}.tells(), K${i}.prototype.tells.call(o${i}));`
      : `console.log(typeof o${i}.tells);`,
    has.construct ? `console.log(new K${i}(1, 2).built, o${i}.built);` : `console.log(o${i}.built);`,
  ];
  const told: string[] = [];
  for (let i = 0; i < count; i++)
    for (const ask of random.sample(asks(i), random.pick([1, 1, 2]))) told.push(attempt(ask));
  const scene = [
    ...classes,
    ...instances.map(attempt).map((text, index) => text.replace(`const o${index} =`, `o${index} =`)),
    ...told,
  ].join("\n");
  const declared = `let ${Array.from({ length: count }, (_, index) => `o${index}`).join(", ")};`;
  const head = [bases, mixin, second].filter(Boolean).join("\n");
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const where = random.pick(["top", "top", "once", "twice"] as const);
  if (where === "top") return { file, text: `${head}\n${declared}\n${guarded(scene)}\n` };
  return {
    file,
    text: `${head}\nfunction run() {\n${declared}\n${scene}\n}\n${guarded(where === "once" ? "run();" : "run();\nrun();")}\n`,
  };
}
