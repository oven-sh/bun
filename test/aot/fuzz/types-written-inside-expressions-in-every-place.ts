// Expressions that hold what is only a type: `as`, `as const`, `satisfies`, `!`, `<T>value` and type arguments. None of them does anything when the program runs, wherever it stands.
//
//   targets     of `=` and every compound assignment, `++` and `--`, of patterns with defaults and rests, in the heads of `for .. of` and `for .. in`
//   callees     a member that is called keeps its `this`; so does a tag of a template; `new` over what is wrapped; type arguments on calls, on `new`, on tags, and with no call behind them
//   chains      `?.` with `!` inside it goes on as one chain; parentheses, `as` and `satisfies` end it; under `delete`, `typeof` and `void`
//   names       a function or a class without a name takes the name of what it is assigned to, also through what is only a type
//   values      `as const` on literals of every kind, made anew each time; operators beside `as`; `await` and `yield`; `extends`, computed keys, spreads, `in`, `instanceof`, `this`, `super`
import type { Random } from "./random";

const head = `const lines: string[] = [];
function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell<T>(label: string, value: T): T {
  note("runs", label);
  return value;
}
function attempt(label: string, run: () => unknown): void {
  try {
    note(label, run());
  } catch (error) {
    note(label, "THROWS", (error as Error).constructor.name);
  }
}
`;

export function generate(random: Random): string {
  /** The expression with something around it that is only a type. What comes out can stand wherever a member access can. */
  const wrap = (text: string): string =>
    random.weighted([
      [4, `(${text} as any)`],
      [1, `(${text} as unknown as any)`],
      [3, `(${text} satisfies unknown)`],
      [4, `${text}!`],
      [1, `${text}!!`],
      [2, `(${text}!)`],
      [3, `(<any>${text})`],
      [1, `(${text} as any)!`],
      [1, `((${text} as any) satisfies any)`],
      [1, `(${text})`],
      [1, text],
    ]);
  /** The same around a function, a class or another expression that needs parentheses of its own. */
  const around = (text: string): string =>
    random.weighted([
      [4, `(${text}) as any`],
      [2, `((${text}) as any)`],
      [3, `(${text}) satisfies unknown`],
      [3, `(${text})!`],
      [3, `<any>(${text})`],
      [text.includes("=>") ? 0 : 1, `(${text} as any)`],
      [1, `(((${text})) as unknown) as any`],
      [1, `(${text})`],
    ]);
  const values = ["1", '"text"', "null", "undefined", "0", "[1]", "{ a: 1 }", "-0"];

  const kinds: ((id: number) => string[])[] = [
    id => [
      `let x${id}: any = ${random.pick(values)};`,
      ...Array.from(
        { length: random.between(1, 3) },
        () =>
          `${wrap(`x${id}`)} ${random.pick(["=", "+=", "||=", "&&=", "??=", "**=", ">>>=", "-="])} tell<any>("value", ${random.pick(values)});\nnote("assigned", x${id});`,
      ),
      `${random.pick([`${wrap(`x${id}`)}++`, `++${wrap(`x${id}`)}`, `${wrap(`x${id}`)}--`, `--${wrap(`x${id}`)}`])};`,
      `note("stepped", x${id});`,
    ],
    id => [
      `const o${id}: any = {\np: ${random.pick(values)},\nget q() {\nnote("get q");\nreturn 5;\n},\nset q(given) {\nnote("set q", given);\n},\n};`,
      `${wrap(`${wrap(`tell("object", o${id})`)}.p`)} ${random.pick(["=", "+=", "||=", "&&=", "??="])} tell("value", ${random.pick(values)});`,
      `${wrap(`o${id}[${wrap(`tell("key", "q")`)}]`)} ${random.pick(["=", "+=", "||=", "&&=", "??="])} tell("value", ${random.pick(values)});`,
      `note(${random.pick([`${wrap(`o${id}.p`)}++`, `++${wrap(`o${id}.q`)}`, `${wrap(`o${id}["q"]`)}--`, `--${wrap(`o${id}.p`)}`])});`,
      `note("holds", o${id}.p);`,
    ],
    id => [
      `let a${id}: any, b${id}: any;\nconst o${id}: any = {};`,
      `[${wrap(`a${id}`)}, ${wrap(`o${id}.p`)} = tell("default", 3), ...${wrap(`b${id}`)}] = [1, ${random.pick(["undefined", "2"])}, 3, 4];`,
      `note("from a list", a${id}, b${id}, o${id});`,
      `({ a: ${wrap(`a${id}`)}, b: ${wrap(`o${id}[tell("key", "q")]`)} = tell("default", 4), ...${wrap(`b${id}`)} } = { a: 5, c: 2, d: 3 } as any);`,
      `note("from an object", a${id}, b${id}, o${id});`,
      `[[${wrap(`a${id}`)}] = [tell("inner default", 6)], { b: ${wrap(`b${id}`)} } = { b: 7 }] = [] as any;`,
      `note("from defaults", a${id}, b${id});`,
    ],
    id => [
      `let x${id}: any;\nconst o${id}: any = {};`,
      `for (${wrap(`x${id}`)} of [1, 2]) note("of", x${id});`,
      `for (${wrap(`o${id}.p`)} in { a: 1, b: 2 }) note("in", o${id}.p);`,
      `for (${wrap(`o${id}[tell("key", "q")]`)} of ["c", "d"]) note("of", o${id}.q);`,
      `for ([${wrap(`x${id}`)}, ${wrap(`o${id}.r`)}] of [[1, 2]] as any) note("a pattern", x${id}, o${id}.r);`,
    ],
    id => [
      `const o${id} = {\nm<T = unknown>(this: any, ...given: any[]): any {\nreturn [this === o${id}, this === undefined, given.length];\n},\ninner: {\nm(this: any): any {\nreturn [this === o${id}.inner, this === undefined];\n},\n},\n};`,
      ...random
        .sample(
          [
            `${wrap(`o${id}.m`)}(1)`,
            `${wrap(`o${id}.m`)}?.(1)`,
            `${wrap(`o${id}?.m`)}(1)`,
            `${wrap(`o${id}["m"]`)}(1)`,
            `${wrap(`o${id}.m`)}\`text\``,
            `${wrap(`${wrap(`o${id}.inner`)}.m`)}()`,
            `${wrap(`o${id}?.inner?.m`)}()`,
            `${wrap(`${wrap(`o${id}`)}.m`)}(...${wrap("[1, 2]")})`,
            `(tell("left", 0), ${wrap(`o${id}.m`)})()`,
            `(${wrap(`o${id}.m`)} || 0)()`,
            `${wrap(`o${id}.m`)}.call(1)`,
            `${wrap(`(o${id}.m)`)}()`,
            `o${id}.m<number>(1)`,
            `o${id}.m?.<number>(1)`,
            `o${id}?.m<number>(1)`,
            `(o${id}.m<number>)(1)`,
          ],
          random.between(3, 7),
        )
        .map(call => `attempt(${JSON.stringify(call.replaceAll(String(id), ""))}, () => ${call});`),
    ],
    id => {
      const rows: string[] = [];
      for (let count = random.between(3, 7); count > 0; count--) {
        let chain = `o`;
        const path = ["a", "b", "c"].slice(0, random.between(1, 3));
        for (const name of path) {
          const link = random.pick([".", "?.", "?.", "!.", "!?."]);
          chain += random.chance(0.7)
            ? link + name
            : link.replace(/\.$/, link.includes("?") ? "." : "") + `["${name}"]`;
          if (random.chance(0.15)) chain = wrap(chain);
        }
        chain += random.pick(["", "", "!", ".m()", "?.m()", "!.m()", ".m!()", ".m?.()", "?.m!?.()"]);
        const prefix = /\)$|!$/.test(chain)
          ? random.pick(["", "typeof ", "void "])
          : random.pick(["", "", "typeof ", "delete ", "delete "]);
        rows.push(`attempt(${JSON.stringify(prefix + chain)}, () => ${prefix}${chain});`);
      }
      return [
        `for (const make${id} of [() => undefined, () => null, () => ({}), () => ({ a: null }), () => ({ a: { b: undefined, m() {\nreturn "a.m";\n} } }), () => ({ a: { b: { c: { m() {\nreturn this === undefined ? "lost" : "c.m";\n} }, m() {\nreturn "b.m";\n} } } })]) {\nconst o: any = make${id}();\nnote("over", o);\n${rows.join("\n")}\nnote("left", o);\n}`,
      ];
    },
    id => [
      `const seen${id}: unknown[] = [];\nfunction tag${id}<T = unknown>(this: any, strings: TemplateStringsArray, ...given: T[]) {\nseen${id}.push(strings);\nreturn [strings.join("|"), strings.raw.join("|"), given, this === holder${id}];\n}\nconst holder${id} = { tag: tag${id} };`,
      `for (let turn = 0; turn < 2; turn++) {\nnote(tag${id}<number>\`a\${turn}b\`, ${wrap(`tag${id}`)}\`c\\n\`, ${wrap(`holder${id}.tag`)}\`d\${turn}\`, holder${id}.tag<string>\`e\`, ${wrap(`holder${id}`)}.tag\`e\`);\n}`,
      `note("the same lists", seen${id}.map((each, at) => seen${id}.indexOf(each) === at ? "new" : "seen"));`,
    ],
    id => [
      `class C${id}<T = unknown> {\nconstructor(public given?: T) {\nnote("made", new.target === C${id}, new.target!.name);\n}\n}\nconst holder${id} = { C: C${id} };`,
      `note(new ${wrap(`C${id}`)}(1), new C${id}<number>(2), new C${id}<number>, new ${wrap(`C${id}`)}, new ${wrap(`holder${id}.C`)}(3), new (C${id}<number>)(4), new ${wrap(`tell("class", C${id})`).replace(/^tell.*$/, found => `(${found})`)}(5));`,
      `const same${id} = C${id}<string>;\nnote(same${id} === C${id}, new same${id}("text"));`,
    ],
    id => {
      const unnamed = () =>
        random.pick([
          "() => {}",
          "function () {}",
          "class {}",
          "async () => {}",
          "function* () {}",
          'class {\nstatic name = "own";\n}',
          "async function () {}",
        ]);
      return [
        `const first${id} = ${around(unnamed())};\nlet second${id}: any = ${around(unnamed())};\nvar third${id}: any = ${around(unnamed())};`,
        `let fourth${id}: any;\nfourth${id} = ${around(unnamed())};\nlet fifth${id}: any;\nfifth${id} ??= ${around(unnamed())};\nlet sixth${id}: any = 0;\nsixth${id} ||= ${around(unnamed())};\nlet seventh${id}: any = 1;\nseventh${id} &&= ${around(unnamed())};`,
        `note("variables", [first${id}, second${id}, third${id}, fourth${id}, fifth${id}, sixth${id}, seventh${id}].map((each: any) => each.name));`,
        `const held${id}: any = { key: ${around(unnamed())}, ["computed"]: ${around(unnamed())}, 1: ${around(unnamed())} };\nheld${id}.stored = ${around(unnamed())};\nnote("members", Object.keys(held${id}).map(key => held${id}[key].name));`,
        `function takes${id}(given: any = ${around(unnamed())}, { inner = ${around(unnamed())} }: any = {}, [item = ${around(unnamed())}]: any = []) {\nreturn [given.name, inner.name, item.name];\n}\nnote("defaults", takes${id}());`,
        `class Holds${id} {\nfield: any = ${around(unnamed())};\nstatic fixed: any = ${around(unnamed())};\n#hidden: any = ${around(unnamed())};\nread() {\nreturn this.#hidden.name;\n}\n}\nnote("fields", new Holds${id}().field.name, Holds${id}.fixed.name, new Holds${id}().read());`,
        `let eighth${id}: any;\n${wrap(`eighth${id}`)} = ${random.pick(["() => {}", "function () {}", "class {}"])};\nnote("a wrapped target", eighth${id}.name);`,
        `note("no names", [${around(unnamed())}].map((each: any) => each.name), (${around(unnamed())} as any).name);`,
      ];
    },
    id => [
      `function makes${id}(given = [1, 2] as const, { a } = { a: ${id} } as const) {\nreturn [given, a, [3, [4]] as const, { b: { c: 5 } } as const, \`t\${a}\` as const, "text" as const, -1 as const, true as const] as const;\n}`,
      `const once${id} = makes${id}();\nnote(once${id}, Object.isFrozen(once${id}), once${id} === makes${id}(), once${id}[2] === makes${id}()[2], once${id}[0] === makes${id}()[0]);`,
      `attempt("changed", () => {\n(once${id} as any).push(1);\n(once${id}[3] as any).b.c = 6;\nreturn [once${id}.length, once${id}[3], makes${id}()[3]];\n});`,
      `const Kinds${id} = { A: "a", B: "b" } as const satisfies Record<string, string>;\ntype Kind${id} = (typeof Kinds${id})[keyof typeof Kinds${id}];\nfunction names${id}(kind: Kind${id}) {\nswitch (kind) {\ncase Kinds${id}.A:\nreturn "first";\ncase Kinds${id}.B:\nreturn "second";\n}\n}\nnote(names${id}("a"), names${id}(Kinds${id}.B), names${id}("c" as any), [...([1, 2] as const)], { ...({ a: 1 } as const) });`,
    ],
    id => [
      `const x${id}: any = ${random.pick(["3", "-2", '"4"', "0", "null"])},\ny${id}: any = ${random.pick(["2", "0", '"5"', "undefined"])};`,
      `note(-x${id} as number, (-x${id} as number) ** 2, (x${id} as number) ** (y${id} as number), !x${id} as boolean, typeof x${id} as string, void 0 as undefined, x${id} ?? (y${id} as any), (x${id} as any) ?? y${id}, x${id} || y${id} satisfies any, x${id} + y${id} as any, <number>x${id} + <number>y${id}, -(<number>x${id}), x${id}! + y${id}!, x${id}! - -y${id}!, (x${id} as number) < (y${id} as number), x${id}! < y${id}!, x${id} as any ? "yes" : "no", (tell("left", x${id}), y${id})!, (x${id} ? x${id} : y${id})!, ~x${id}! as number, +x${id}!, x${id}! in [0, 1, 2, 3], x${id} as any === y${id} as any);`,
    ],
    id => [
      `async function waits${id}() {\nconst p: any = Promise.resolve({ x: ${id} });\nreturn [(await p)!, await (p as any), (await p as any).x, await p!, await (p satisfies unknown), (await p)!.x, (<any>await p).x, await (<any>p)];\n}\nnote(await waits${id}());`,
      `function* steps${id}(): any {\nconst got = (yield 1)!;\nconst more = (yield got) as any;\nconst [first] = (yield* [more] as any) ?? [7];\nreturn ((yield first) satisfies unknown)!;\n}\nconst walk${id} = steps${id}();\nnote(walk${id}.next("a"), walk${id}.next("b"), walk${id}.next("c"), walk${id}.next("d"), walk${id}.next("e"), walk${id}.next("f"));`,
    ],
    id => [
      `const key${id} = "k${id}";\nclass Above${id}<T = unknown> {\nstatic fixed = 1;\nm(this: any) {\nreturn "Above.m";\n}\nget g() {\nreturn "Above.g";\n}\n}`,
      `class Below${id} extends ${random.pick([wrap(`Above${id}`), wrap(`tell("heritage", Above${id})`).replace(/^tell.*$/, found => `(${found})`), `Above${id}<number>`])} {\n// @ts-ignore\n[${wrap(`key${id}`)}] = 1;\n// @ts-ignore\n[${wrap(`tell("key", "n")`)}]() {\nreturn "n";\n}\n// @ts-ignore\nstatic [${wrap('"s"')}] = 2;\nm(): any {\nreturn [super.m!(), (super.m as any).call(this), ${wrap("super.g")}, ${wrap("super.m")}(), this!.y, (this as any).y, (<any>this).y, ${wrap("this")}.y];\n}\ny = (${wrap("this")} as any).z;\nz = 3;\n}`,
      `const below${id}: any = new Below${id}();\nnote(below${id}, below${id}.m(), below${id}.n(), Reflect.ownKeys(Below${id}), (Below${id} as any).fixed);`,
    ],
    id => [
      `const o${id}: any = { a: 1, b: 2 },\nlist${id}: any = [1, 2],\nk${id}: any = "c";\nclass C${id} {\n#p = 1;\nstatic has(given: any) {\nreturn [#p in ${wrap("given")}, ${wrap("given")} instanceof ${wrap(`C${id}`)}];\n}\n}`,
      `note({ ...${wrap(`o${id}`)}, [${wrap(`k${id}`)}]: ${wrap("3")}, d: ${wrap(`o${id}.a`)} }, [...${wrap(`list${id}`)}, ${wrap("3")}], Math.max(...${wrap(`list${id}`)}), ${wrap('"a"')} in ${wrap(`o${id}`)}, C${id}.has(new C${id}()), C${id}.has({}), ${wrap(`list${id}`)}[${wrap("0")}], ${wrap(`\`t\${${wrap(`k${id}`)}}\``)}, ${wrap("/x/g")}.flags, ${wrap("(1)")}.toFixed(1), ${wrap("[1, 2]")}.length, ${wrap("{ a: 1 }").replace(/^\{.*$/, found => `(${found})`)}.a);`,
      `function reads${id}(this: any, ...given: any[]) {\nreturn [${wrap("arguments")}.length, ${wrap("this")} === undefined, ${wrap("new.target")} === undefined, typeof ${wrap("import.meta")}, ${wrap("given")}.length];\n}\nnote(reads${id}(1, 2), new (reads${id} as any)(1));`,
      `${wrap(`tell("a statement", 1)`)};\n${wrap(`o${id}.a`)};\n${wrap(`o${id}`)}.a;`,
    ],
    id => [
      `const same${id} = <T,>(given: T): T => given;\nconst later${id} = async <T,>(given: T) => given;\nfunction isText${id}(given: unknown): given is string {\nreturn typeof given === "string";\n}\nfunction must${id}(given: unknown): asserts given {\nif (!given) throw new RangeError("nothing");\n}\nconst holder${id} = {\nname: "holder",\nm<T>(this: any, given?: T) {\nreturn [this?.name, given];\n},\n};`,
      `const narrowed${id} = same${id}<number>;\nconst taken${id} = holder${id}.m<number>;\nconst Texts${id} = Map<string, number>;`,
      `note(same${id}<number>(1), await later${id}<string>("text"), same${id}.name, later${id}.length, isText${id}(1), isText${id}("a"), narrowed${id} === same${id}, narrowed${id}(2), new Texts${id}([["a", 1]]).size, Texts${id} === Map, (same${id}<string>)("b"), same${id}?.<number>(3), holder${id}.m<number>(4), holder${id}?.m<number>(5), holder${id}.m?.<number>(6));`,
      `attempt("a method taken with a type argument", () => taken${id}(7));\nattempt("asserts", () => must${id}(0));\nattempt("asserts", () => must${id}(1));`,
    ],
  ];

  const rows: string[] = [];
  for (let id = 0, scenes = random.between(4, 8); id < scenes; id++) {
    const at = random.below(kinds.length);
    rows.push(`note("scene ${id}, kind ${at}");`, ...kinds[at](id));
  }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\nexport {};\n`;
}
