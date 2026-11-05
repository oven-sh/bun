// Ask, change, ask again. A compiler proves things about the objects and classes of a program: which names an object has, where a method is found, what stands above what. Each proof holds until something
// changes, and the program may change nearly everything: a name comes or goes, a method is replaced, a prototype is hung elsewhere, a field becomes an accessor, an object is frozen.
//
// The scene is put together from tables that do not know of each other: who is made and how, what is asked of them and where, what changes, on whom, and by which road. The same questions are asked in front of
// the change and behind it. Whoever is asked is named where it is asked: a list of all of them would let them out of sight, and the compiler would prove nothing that could turn out false.

export function writeSceneOfAChange(random: () => number, n: number, isTypeScript: boolean): string[] {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const any = typed("any");
  const cast = isTypeScript ? " as any" : "";
  const loose = (name: string) => (isTypeScript ? `(${name} as any)` : name);
  const work = "let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;";
  const value = () => pick(["1", "2", "7", "0.5", '"text"', "null", "undefined", "true", "[1]", "{ deep: 1 }"]);

  // Who is there: a row of two or three makers, each with a member `size`, a method `tell` and perhaps more.
  const kind = pick([
    "classes",
    "classes",
    "classes",
    "classes",
    "functions",
    "functions",
    "literals",
    "literals",
    "created",
  ]);
  const [Top, Mid, Low] = [`Top${n}`, `Mid${n}`, `Low${n}`];
  // At each level each of the two names is a method, a field, an accessor or nothing. TypeScript wants one kind for a name down the row.
  type Member = "method" | "field" | "accessor" | "none";
  const drawMember = () =>
    pick<Member>(["method", "method", "method", "field", "field", "field", "accessor", "none", "none"]);
  const oneKind: Record<string, Member> = {
    size: pick<Member>(["field", "field", "accessor", "method"]),
    tell: pick<Member>(["method", "method", "field"]),
  };
  const members = (level: number, mayLack: boolean) =>
    ["size", "tell"]
      .map(name => {
        const drawn = drawMember();
        const member =
          !mayLack && drawn === "none" ? "method" : isTypeScript && drawn !== "none" ? oneKind[name] : drawn;
        return member === "method"
          ? `${name}()${any} { ${level === 2 && chance(30) ? work + " return work + " : "return "}${level}; }`
          : member === "field"
            ? `${name}${any} = ${level};`
            : member === "accessor"
              ? `get ${name}()${any} { return ${level}; }`
              : "";
      })
      .filter(Boolean);
  const isStatic = kind === "classes" && chance(25);
  const word = isStatic ? "static " : "";
  const makers =
    kind === "classes"
      ? [
          `class ${Top} { ${members(1, false)
            .map(each => word + each)
            .join(" ")} }`,
          `class ${Mid} extends ${Top} { ${members(2, true)
            .map(each => word + each)
            .join(" ")} }`,
          `class ${Low} extends ${Mid} { ${(chance(60) ? [] : members(3, true)).map(each => word + each).join(" ")} }`,
        ]
      : kind === "functions"
        ? [
            `function ${Top}(${isTypeScript ? "this: any" : ""}) { this.size = 1; }`,
            `${Top}.prototype.tell = function () { return 1; };`,
            `function ${Mid}(${isTypeScript ? "this: any" : ""}) { ${pick([`${Top}.call(this);`, `${Top}.call(this);`, ""])} this.more = 2; }`,
            pick([
              `${Mid}.prototype = Object.create(${Top}.prototype);`,
              `Object.setPrototypeOf(${Mid}.prototype, ${Top}.prototype);`,
              `${Mid}.prototype = Object.create(${Top}.prototype, { constructor: { value: ${Mid} } });`,
            ]),
            `function ${Low}(${isTypeScript ? "this: any" : ""}) { ${Mid}.call(this); }`,
            pick([
              `${Low}.prototype = Object.create(${Mid}.prototype);`,
              `Object.setPrototypeOf(${Low}.prototype, ${Mid}.prototype);`,
              `${Low}.prototype = ${Mid}.prototype;`,
            ]),
          ]
        : [];
  const make = (Maker: string) => (isTypeScript && kind === "functions" ? `new (${Maker} as any)()` : `new ${Maker}()`);
  const instances =
    kind === "literals"
      ? [
          `const top${any} = { size: 1, tell() { return 1; } };`,
          `const mid${any} = ${pick(["{ size: 2, tell() { return 2; } }", "{ size: 2, tell() { return 2; } }", "{ tell() { return 2; }, size: 2 }", "{ size: 2, tell() { return 2; }, more: 1 }", "{ __proto__: top, more: 1 }"])};`,
          `const low${any} = ${pick(["{ size: 3, tell() { return 3; } }", "{ __proto__: mid }", "Object.create(mid)", "{ ...mid }", "Object.assign({}, mid)"])};`,
        ]
      : kind === "created"
        ? [
            `const top${any} = { size: 1, tell() { return 1; }, get label() { return this._label; }, set label(value) { this._label = value; } };`,
            `const mid${any} = Object.create(top); mid.tag = 2;`,
            `const low${any} = Object.create(mid); low.tag = 3;`,
          ]
        : isStatic
          ? [`const top${any} = ${Top};`, `const mid${any} = ${Mid};`, `const low${any} = ${Low};`].slice(0, 0)
          : [`const top${any} = ${make(Top)};`, `const mid${any} = ${make(Mid)};`, `const low${any} = ${make(Low)};`];
  const [top, mid, low] = isStatic ? [loose(Top), loose(Mid), loose(Low)] : ["top", "mid", "low"];

  // What is asked, of one who is named.
  const hasMakers = kind === "classes" || kind === "functions";
  const question = pick<(who: string) => string>([
    who => `typeof ${who}.size === "function" ? ${who}.size() : ${who}.size`,
    who => `typeof ${who}.size === "function" ? ${who}.size() : ${who}.size`,
    who => `${who}.size`,
    who => `typeof ${who}.tell === "function" ? ${who}.tell() : typeof ${who}.tell`,
    who => `typeof ${who}.tell === "function" ? ${who}.tell() : typeof ${who}.tell`,
    who => `${who}.late`,
    who => `${who}.late !== undefined`,
    who => `"late" in ${who}`,
    who => `"size" in ${who}`,
    who => `Object.keys(${who}).join()`,
    who => `JSON.stringify(${who})`,
    who => `Object.hasOwn(${who}, "size")`,
    who => `typeof ${who}.size`,
    who => `typeof ${who}.size + typeof ${who}.tell`,
    who => `String(${who}.more)`,
    who => `(({ size }) => size)(${who})`,
    who => `Object.getPrototypeOf(${who}) === Object.getPrototypeOf(${mid})`,
    ...(hasMakers && !isStatic
      ? [
          (who: string) => `${who} instanceof ${Mid}`,
          (who: string) => `${who} instanceof ${Mid}`,
          (who: string) => `${who} instanceof ${Top}`,
          (who: string) => `${who} instanceof ${Low}`,
          (who: string) => `${who} instanceof ${Low}`,
          (who: string) => `${who} instanceof ${Low} ? ${who}.size : "no"`,
          (who: string) => `${who}.constructor === ${Low}`,
          (who: string) => `${Mid}.prototype.isPrototypeOf(${who})`,
        ]
      : []),
    ...(kind === "created" ? [(who: string) => `${who}.label`, (who: string) => `${who}._label !== undefined`] : []),
  ]);
  // Where it is asked: written out for each, in a function that takes one of them, or in a loop.
  const where = pick(["written", "written", "written", "function", "function", "loop", "loop", "method"]);
  const asker =
    where === "function"
      ? [`function ask${n}(who${any})${any} { ${chance(50) ? work : ""} return ${question("who")}; }`]
      : where === "loop"
        ? [
            `function ask${n}(who${any})${any} { let said${any}; for (let i = 0; i < ${pick([3, 3, 100])}; i++) said = ${question("who")}; return said; }`,
          ]
        : where === "method"
          ? [`const asker${n} = { ask(who${any})${any} { return ${question("who")}; } };`]
          : [];
  const ask = (who: string) =>
    where === "written" ? question(who) : where === "method" ? `asker${n}.ask(${who})` : `ask${n}(${who})`;
  // Only the answer goes through `show`, never who was asked. The text of a function is not an answer.
  const told = `[${[top, mid, low].map(who => `show${n}(${ask(who)})`).join(", ")}].join("|")`;

  // What changes, on whom.
  const proto = (Maker: string) => loose(`${Maker}.prototype`);
  const targets = isStatic
    ? [top, mid, low]
    : hasMakers
      ? [low, low, mid, proto(Low), proto(Mid), proto(Mid), proto(Top), `Object.getPrototypeOf(${low})`]
      : // What stands above a literal is Object.prototype, and an executable refuses a store there.
        [low, low, mid, mid, top, ...(kind === "created" ? [`Object.getPrototypeOf(${low})`] : [])];
  const drawChange = () => {
    const whom = pick(targets);
    const name = pick([
      "size",
      "size",
      "tell",
      "tell",
      "late",
      "late",
      "more",
      ...(kind === "created" ? ["_label", "_label", "label"] : []),
    ]);
    return pick([
      `${whom}.${name} = ${value()};`,
      `${whom}.${name} = ${value()};`,
      `${whom}.${name} = ${value()};`,
      `${whom}.tell = () => 9;`,
      `${whom}.tell = function () { return 9; };`,
      `delete ${whom}.${name};`,
      `delete ${whom}.${name};`,
      `Object.defineProperty(${whom}, "${name}", { value: ${value()}, configurable: true });`,
      `Object.defineProperty(${whom}, "${name}", { get() { return 9; }, configurable: true });`,
      `Object.defineProperty(${whom}, "${name}", { value: ${value()}, enumerable: false, writable: true, configurable: true });`,
      `${whom}[["${name.slice(0, 1)}", "${name.slice(1)}"].join("")] = ${value()};`,
      `Reflect.set(${whom}, "${name}", ${value()});`,
      `Object.assign(${whom}, { ${name}: ${value()} });`,
      `Object.setPrototypeOf(${whom}, ${pick(["null", "{}", `{ ${name}: 9 }`, isStatic ? "Function.prototype" : top, `Object.getPrototypeOf(${top})`])});`,
      `Object.setPrototypeOf(${whom}, ${pick(["null", `{ ${name}: 9 }`, `Object.create(Object.getPrototypeOf(${whom}))`])});`,
      `${whom}.__proto__ = ${pick(["null", `{ ${name}: 9 }`])};`,
      `Object.freeze(${whom}); try { ${whom}.${name} = 9; } catch (error) { heard${n}++; }`,
      `Object.preventExtensions(${whom}); try { ${whom}.late = 9; } catch (error) { heard${n}++; }`,
      ...(hasMakers && !isStatic
        ? [
            `${loose(Mid)}.prototype = ${pick([`${Top}.prototype`, "{}"])};`,
            `Object.defineProperty(${Mid}, Symbol.hasInstance, { value: () => ${pick(["true", "false"])} });`,
          ]
        : []),
    ]);
  };
  const road = pick<(deed: string) => string[]>([
    deed => [deed],
    deed => [deed],
    deed => [deed],
    deed => [`function change${n}() { ${work} ${deed} return work; }`, `change${n}();`],
    deed => [`function change${n}() { ${work} ${deed} return work; }`, `change${n}();`],
    deed => [`[() => { ${deed} }][JSON.parse("0")]();`],
    deed => [`for (let turn = 0; turn < 3; turn++) { if (turn === 1) { ${deed} } }`],
  ]);
  const safely = (lines: string[]) =>
    lines.length === 1
      ? [`try { ${lines[0]} } catch (error) { heard${n} += 10; }`]
      : [lines[0], `try { ${lines[1]} } catch (error) { heard${n} += 10; }`];
  const tells = (label: string) =>
    `try { printValue("${label} ${n}", ${told}, heard${n}); } catch (error) { printValue("${label} ${n}", (error${cast}).name); }`;
  // Two changes that belong together: what the first lays the second takes away, cuts off or turns into something else.
  const one = pick(targets);
  const pairs: [string, string][] = [
    ...(isStatic
      ? []
      : ([
          [
            `Object.setPrototypeOf(${low}, link${n});`,
            `Object.setPrototypeOf(link${n}, ${pick(["null", "null", "{}", `Object.getPrototypeOf(${top})`])});`,
          ],
          [
            `Object.setPrototypeOf(${low}, link${n});`,
            `Object.setPrototypeOf(link${n}, ${pick(["null", "null", "{}"])});`,
          ],
          [`Object.setPrototypeOf(${low}, link${n});`, `link${n}.${pick(["size", "tell", "late"])} = ${value()};`],
        ] as [string, string][])),
    [`${one}.late = 1;`, `delete ${one}.late;`],
    [`${one}.late = 1;`, `${one}.late = ${value()};`],
    [`kept${n} = ${one}.tell; ${one}.tell = () => 9;`, `${one}.tell = kept${n};`],
    [
      `Object.defineProperty(${one}, "size", { get() { return 9; }, configurable: true });`,
      `Object.defineProperty(${one}, "size", { value: 8, writable: true, configurable: true });`,
    ],
    [`delete ${one}.size;`, `${one}.size = ${value()};`],
    [`Object.freeze(${one});`, `${one}.size = 9;`],
  ];
  const [first, second] = chance(35) ? pick(pairs) : [drawChange(), chance(40) ? drawChange() : ""];
  return [
    `let heard${n} = 0;`,
    `function show${n}(answer${any})${typed("string")} { return typeof answer === "function" ? "function" : String(answer); }`,
    ...makers,
    ...instances.map(line => line.replace(/\b(top|mid|low)\b/g, `$1${n}`)),
    ...asker,
    ...(chance(70) ? [tells("before")] : []),
    ...(first.includes(`link${n}`)
      ? [
          `const link${n}${any} = Object.create(${hasMakers && chance(80) ? `${Low}.prototype` : `Object.getPrototypeOf(${low})`});`,
        ]
      : []),
    ...(first.includes(`kept${n}`) ? [`let kept${n}${any};`] : []),
    ...safely(road(first)),
    tells("behind"),
    ...(second
      ? [...safely(road(second)).map(line => line.replaceAll(`change${n}`, `again${n}`)), tells("at last")]
      : []),
  ].map(line => line.replace(/(?<![\w$."'])(top|mid|low)(?![\w$:"'])/g, `$1${n}`));
}
