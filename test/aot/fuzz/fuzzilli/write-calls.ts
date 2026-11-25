// One function, called from several places that are unlike each other. A compiler types the parameters of a function by what its call sites bring, copies its head or its whole body into some of them, and keeps a
// slower way in for the rest. A fault shows where one site is counted and another is not: a call under a `try`, through `apply`, as a callback of a built-in, with an argument too few, with another kind of value.
//
// The scene is put together from tables that do not know of each other: how the function is written and what stands at its head, which parameters it takes, from where it is called and how, with which kinds of
// values. Every call says what arrived: the type and the text of each parameter.

export function writeSceneOfCalls(random: () => number, n: number, isTypeScript: boolean): string[] {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const any = typed("any");
  const loose = (text: string) => (isTypeScript ? `(${text} as any)` : text);
  const work = "let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;";

  // The kinds of values. A site mostly stays with one kind, and the sites differ.
  const kinds = [
    "7",
    "7",
    "3",
    "0.5",
    '"text"',
    '"text"',
    '""',
    "null",
    "undefined",
    "{ deep: 1 }",
    "[1]",
    "true",
    "4294967296",
    "-0",
    "NaN",
    "12n",
  ];
  const inSight = (value: string) => value;
  const outOfSight = (value: string) =>
    /^(?:undefined|-0|NaN|12n)$/.test(value)
      ? `[${value}][JSON.parse("0")]`
      : `JSON.parse(${JSON.stringify(value.replace(/(\w+):/g, '"$1":'))})`;

  // How the function is written.
  const parameters = pick(["a, b", "a, b", "a, b", "a, b = 5", "a, ...rest", "a, b, c", "{ a, b }"]);
  const takesARecord = parameters === "{ a, b }";
  const hasRest = parameters.includes("...rest");
  const second = hasRest ? "rest[0]" : "b";
  const written = isTypeScript
    ? parameters === "{ a, b }"
      ? "{ a, b }: any"
      : parameters
          .split(", ")
          .map(each =>
            each.startsWith("...")
              ? `${each}: any[]`
              : each.includes(" = ")
                ? each.replace(" = ", ": any = ")
                : `${each}?: any`,
          )
          .join(", ")
    : parameters;
  const shape = pick([
    "function",
    "function",
    "function",
    "function",
    "arrow",
    "method",
    "static",
    "literal",
    "closure",
    "async",
  ]);
  const usesArguments = shape !== "arrow" && shape !== "closure" && !takesARecord && chance(25);
  const head = pick([
    "",
    "",
    "",
    `if (a === undefined) return "none";`,
    `if (typeof a !== "number") return "other " + typeof a + ":" + typeof ${second};`,
    `if (typeof a === "string") return "text " + a.length + ":" + typeof ${second};`,
    `if (box${n}.cached) return box${n}.cached;`,
    `if (a === null) return "null:" + typeof ${second};`,
    `if (!a) return "nothing " + String(a) + ":" + typeof ${second};`,
    `if (calls${n}++ > 90) return "often";`,
  ]);
  const middle = pick([
    "",
    `let sum = 0; for (let i = 0; i < 3; i++) sum = (sum + i) | 0;`,
    `let sum = 0; for (let i = 0; i < 3; i++) sum = (sum + i) | 0;`,
    `let sum = 0; for (let i = 0; i < 3; i++) sum += typeof a === "number" ? a : 1;`,
    `let sum = 0; try { sum = a + 1; } catch (error) { sum = -1; }`,
    `const sum = typeof a === typeof ${second} ? 1 : 0;`,
  ]);
  const says = [
    `typeof a`,
    `String(a)`,
    `typeof ${second}`,
    `String(${second})`,
    ...(middle ? ["String(sum)"] : []),
    ...(usesArguments ? ["arguments.length"] : []),
    ...(hasRest ? ["rest.length"] : []),
  ];
  const store = head.includes("cached") ? `box${n}.cached = chance${n}++ > 2 ? "cached" : "";` : "";
  const body = `${head} ${middle} ${store} return [${says.join(", ")}].join(":");`.replace(/ +/g, " ");
  const name = `callee${n}`;
  const [declared, reference, self] =
    shape === "function"
      ? [[`function ${name}(${written})${any} { ${body} }`], name, "undefined"]
      : shape === "async"
        ? [[`async function ${name}(${written})${typed("Promise<any>")} { ${body} }`], name, "undefined"]
        : shape === "arrow"
          ? [[`const ${name} = (${written})${any} => { ${body} };`], name, "undefined"]
          : shape === "method"
            ? [
                [
                  `class Holder${n} { base = 1; run(${written})${any} { ${body} } }`,
                  `const holder${n} = new Holder${n}();`,
                ],
                `holder${n}.run`,
                `holder${n}`,
              ]
            : shape === "static"
              ? [[`class Holder${n} { static run(${written})${any} { ${body} } }`], `Holder${n}.run`, `Holder${n}`]
              : shape === "literal"
                ? [
                    [`const holder${n} = { base: 1, run(${written})${any} { ${body} } };`],
                    `holder${n}.run`,
                    `holder${n}`,
                  ]
                : [
                    [
                      `function make${n}(base${any}) { return (${written})${any} => { ${body.replace("return [", "return [base, ")} }; }`,
                      `const ${name} = make${n}(${pick(["1", '"k"'])});`,
                    ],
                    name,
                    "undefined",
                  ];
  // A cast would hide from the checker, and from whoever listens to it, which function is called: it stands only where a call brings more than the function takes.
  const callee = reference;

  // From where it is called, and how.
  const given = (values: string[]) =>
    takesARecord ? [`{ a: ${values[0] ?? "undefined"}, b: ${values[1] ?? "undefined"} }`] : values;
  const forms: ((values: string[]) => string)[] = [
    values => `return ${callee}(${given(values).join(", ")});`,
    values => `return ${callee}(${given(values).join(", ")});`,
    values => `return ${callee}(${given(values).join(", ")});`,
    values => `try { return ${callee}(${given(values).join(", ")}); } catch (error) { return "caught"; }`,
    values => `try { return ${callee}(${given(values).join(", ")}); } catch (error) { return "caught"; }`,
    values => `try { return ${callee}(${given(values).join(", ")}); } finally { heard${n}++; }`,
    values => `return ${callee}.call(${self}, ${given(values).join(", ")});`,
    values => `return ${callee}.apply(${self}, [${given(values).join(", ")}]);`,
    values => `return ${callee}(...[${given(values).join(", ")}]);`,
    values => `return Reflect.apply(${callee}, ${self}, [${given(values).join(", ")}]);`,
    values => `return ${callee}.bind(${self}, ${given(values)[0]})(${given(values).slice(1).join(", ")});`,
    values =>
      `return [${given(values)[0]}].map(${shape === "method" || shape === "literal" || shape === "static" ? `${callee}.bind(${self})` : callee})[0];`,
    values => `return ${callee}(${given(values.slice(0, 1)).join(", ")});`,
    values => (takesARecord ? `return ${callee}({});` : `return ${callee}();`),
    values => `return ${loose(callee)}(${[...given(values), "8", "9"].join(", ")});`,
    values =>
      `return [...(function* ()${typed("Generator<any>")} { yield ${callee}(${given(values).join(", ")}); })()][0];`,
    values =>
      `const taken${any} = [${shape === "method" || shape === "literal" || shape === "static" ? `${callee}.bind(${self})` : callee}][JSON.parse("0")]; return taken(${given(values).join(", ")});`,
    values =>
      `return (work > 90 ? other${n} : ${shape === "method" || shape === "literal" || shape === "static" ? `${callee}.bind(${self})` : callee})(${given(values).join(", ")});`,
    values =>
      `let out${any} = ""; for (const each of [${values.join(", ")}, ${pick(kinds)}]${isTypeScript ? " as any[]" : ""}) out = ${callee}(${given(["each", values[1] ?? "1"]).join(", ")}); return out;`,
    values => `return work > 90 ? "never" : ${callee}(${given(values).join(", ")});`,
    values => `return (() => ${callee}(${given(values).join(", ")}))();`,
  ];
  const sites = Array.from({ length: pick([2, 2, 3, 3, 4]) }, (_, at) => {
    const see = chance(65) ? inSight : outOfSight;
    const values = [see(pick(kinds)), see(pick(kinds))];
    return `function site${n}_${at}()${any} { ${work} ${pick(forms)(values)} }`;
  });
  const wait = shape === "async" ? "await " : "";
  const order = sites.map((_, at) => at);
  if (chance(30)) order.reverse();
  return [
    `let heard${n} = 0, calls${n} = 0, chance${n} = 0;`,
    `const box${n}${any} = { cached: "" };`,
    `function other${n}(...all${typed("any[]")})${any} { return "other"; }`,
    ...declared,
    ...sites,
    `for (let round = 0; round < ${pick([1, 1, 2, 2, 30])}; round++) {`,
    `  const said = [${order.map(at => `String(${wait}site${n}_${at}())`).join(", ")}].join(" | ");`,
    `  if (round < 2) printValue("call sites ${n}", said, heard${n});`,
    `}`,
  ];
}
