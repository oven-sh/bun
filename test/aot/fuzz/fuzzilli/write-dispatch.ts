// One call site, many kinds of receivers. A compiler that knows every class of a program calls a method directly where one class arrives, tells a few apart by their shape, and goes through a table for more.
// It reads a field at one offset where all layouts agree and looks the offset up where they do not. A fault shows where a receiver arrives that the site was not built for, or where a class changes behind the build.
//
// The scene is put together from tables that do not know of each other: how the classes stand to each other, how each of them comes by the member, what else arrives at the site, how the site is written,
// and what happens between the first asking and the second.

export function writeSceneOfDispatch(random: () => number, n: number, isTypeScript: boolean): string[] {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const any = typed("any");
  const loose = (text: string) => (isTypeScript ? `(${text} as any)` : text);
  const work = "let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;";

  // The member. Some names are those of methods of built-ins: a text, a list or a table may then arrive at the same site.
  const [name, builtIns] = pick<[string, string[]]>([
    ["tell", []],
    ["tell", []],
    ["tell", []],
    ["area", []],
    ["step", []],
    ["at", ['"text"', "[7, 8]"]],
    ["slice", ['"text"', "[7, 8]"]],
    ["includes", ['"text1"', "[1, 8]"]],
    ["indexOf", ['"text1"', "[7, 1]"]],
    ["concat", ['"text"', "[7]"]],
    ["has", ["new Set([1])", "new Map([[1, 2]])"]],
    ["get", ["new Map([[1, 2]])"]],
    ["replace", ['"1text"']],
    ["toString", ["7", '"text"', "[7, 8]"]],
    ["valueOf", ["7", '"text"']],
  ]);
  // The key under which the member stands. A layout lists the names that a class declares; a symbol, a number or a key that is put together is found another way.
  const key =
    builtIns.length || chance(70)
      ? ""
      : pick(
          isTypeScript
            ? ["Symbol.toStringTag", "Symbol.toStringTag", `own${n}`, `own${n}`, JSON.stringify(name), `text${n}`]
            : [
                "Symbol.toStringTag",
                "Symbol.toStringTag",
                "Symbol.toPrimitive",
                `own${n}`,
                `own${n}`,
                JSON.stringify(name),
                `text${n}`,
                `${JSON.stringify(name.slice(0, 2))} + ${JSON.stringify(name.slice(2))}`,
                "7",
              ],
        );
  // Most scenes are plain: every class holds the member as a method and the site calls it by its name. There the direct calls, the tests of shapes and the tables are built, and one odd thing meets them.
  const isPlain = chance(65);
  const [lead, leads] = name === "replace" ? [`what${any}, `, '"t", '] : ["", ""];
  const count = pick([2, 3, 3, 4, 4, 6, 9]);
  const stands = pick(["row", "row", "siblings", "siblings", "siblings", "unrelated", "mixed"]);
  const names = Array.from({ length: count }, (_, at) => `K${n}_${at}`);
  const above = (at: number) =>
    at === 0 || stands === "unrelated"
      ? ""
      : stands === "row"
        ? names[at - 1]
        : stands === "siblings"
          ? names[0]
          : pick(["", names[0], names[at - 1]]);
  const parents = names.map((_, at) => above(at));
  const classes = names.map((own, at) => {
    const parent = parents[at];
    // Fields in front of `v` move it to another place in each layout.
    const pads = Array.from(
      { length: parent ? pick([0, 0, 1]) : pick([0, 0, 1, 2, at % 3]) },
      (_, pad) => `p${at}_${pad}${any} = ${pad};`,
    );
    const how =
      at === 0 || !parent
        ? pick(isPlain ? ["method"] : ["method", "method", "method", "field", "accessor"])
        : pick(
            isPlain
              ? ["method", "method", "method", "inherits", "super", "closure", "hands back a closure"]
              : ["method", "method", "inherits", "inherits", "super", "field", "accessor", "closure"],
          );
    const answer = `"${at}:" + this.v + ":" + given`;
    const member =
      how === "method"
        ? `${name}(${lead}given${any})${any} { return ${answer}; }`
        : how === "field"
          ? `${name}${any} = (${lead}given${any})${any} => ${answer};`
          : how === "accessor"
            ? `get ${name}()${any} { return (${lead}given${any})${any} => ${answer}; }`
            : how === "super"
              ? `${name}(${lead}given${any})${any} { return "${at}>" + shown${n}(super.${name}(${leads}given)); }`
              : how === "hands back a closure"
                ? `${name}(${lead}given${any})${any} { let count = 0; return () => { count += 1; return "${at}#" + count; }; }`
                : how === "closure"
                  ? `${name}(${lead}given${any})${any} { let calls = 0; const counts = () => ++calls; counts(); return "${at}:" + counts() + ":" + given; }`
                  : "";
    const field = parent ? "" : `v${any} = ${pick([String(at), String(at), `${at}.5`, `"v${at}"`])};`;
    return `class ${own}${parent ? ` extends ${isTypeScript && !isPlain ? `(${parent} as any)` : parent}` : ""} { ${[...pads, field, member].filter(Boolean).join(" ")} }`.replace(
      / +/g,
      " ",
    );
  });

  // Who arrives.
  const others = [
    `{ v: "literal", ${name}(${lead}given${any})${any} { return "literal:" + given; } }`,
    `Object.assign(Object.create(null), { v: "bare", ${name}: (${lead}given${any})${any} => "bare:" + given })`,
    `Object.defineProperty(new ${names[0]}(), ${JSON.stringify(name)}, { value: (${lead}given${any})${any} => "own:" + given, writable: true, configurable: true })`,
    `Object.freeze(new ${names[count - 1]}())`,
    `new Proxy(new ${names[0]}(), {})`,
    `Object.create(new ${names[count - 1]}())`,
    `Object.setPrototypeOf({ v: "adopted" }, ${names[count - 1]}.prototype)`,
    ...builtIns,
    ...builtIns,
  ];
  const instances = names.map(own => `new ${own}()`);
  const arrives = [
    ...instances,
    ...(chance(isPlain ? 25 : 50) ? [pick(others)] : []),
    ...(chance(isPlain ? 0 : 20) ? [pick(others)] : []),
    ...(chance(30) ? [pick(instances)] : []),
  ];
  if (chance(40)) arrives.reverse();
  const oneByOne = chance(30);
  // The site.
  const call = pick([
    ...(isPlain ? Array.from({ length: 16 }, () => `each.${name}(${leads}given)`) : []),
    `each.${name}(${leads}given)`,
    `each.${name}(${leads}given)`,
    `each.${name}(${leads}given)`,
    `each.${name}(${leads}given)`,
    `each?.${name}?.(${leads}given)`,
    `each[key${n}](${leads}given)`,
    `each[${JSON.stringify(name)}](${leads}given)`,
    `each.${name}.call(each, ${leads}given)`,
    `Reflect.apply(each.${name}, each, [${leads}given])`,
    `[each.${name}][0].call(each, ${leads}given)`,
  ]);
  const isTypedList =
    isTypeScript &&
    isPlain &&
    !(key && call.includes(`key${n}`)) &&
    arrives.length === count &&
    (stands === "row" || stands === "siblings") &&
    chance(60);
  const element = isTypedList ? `: ${names[0]}` : any;
  const says = pick([
    `shown${n}(${call})`,
    `shown${n}(${call})`,
    `shown${n}(${call}) + "/" + String(each.v)`,
    `String(each.v) + "/" + shown${n}(${call})`,
    `String(each.v)`,
  ]);
  const site = oneByOne
    ? [
        `function one${n}(each${element}, given${any})${typed("string")} { ${chance(50) ? work : "const work = 0;"} return ${says} + work; }`,
        `function ask${n}(list${isTypedList ? `: ${names[0]}[]` : typed("any[]")}, given${any})${typed("string")} { return [${arrives.map((_, at) => `one${n}(list[${at}], given)`).join(", ")}].join(";"); }`,
      ]
    : pick([
        [
          `function ask${n}(list${isTypedList ? `: ${names[0]}[]` : typed("any[]")}, given${any})${typed("string")} { let out = ""; for (const each of list) out += ${says} + ";"; return out; }`,
        ],
        [
          `function ask${n}(list${isTypedList ? `: ${names[0]}[]` : typed("any[]")}, given${any})${typed("string")} { let out = ""; for (const each of list) out += ${says} + ";"; return out; }`,
        ],
        [
          `function ask${n}(list${isTypedList ? `: ${names[0]}[]` : typed("any[]")}, given${any})${typed("string")} { let out = ""; for (let at = 0; at < list.length; at++) { const each = list[at]; out += ${says} + ";"; } return out; }`,
        ],
        [
          `function one${n}(each${element}, given${any})${typed("string")} { ${work} return ${says} + work; }`,
          `function ask${n}(list${isTypedList ? `: ${names[0]}[]` : typed("any[]")}, given${any})${typed("string")} { return list.map(each => one${n}(each, given)).join(";"); }`,
        ],
        [
          `function one${n}(each${element}, given${any})${typed("string")} { return ${says}; }`,
          `function ask${n}(list${isTypedList ? `: ${names[0]}[]` : typed("any[]")}, given${any})${typed("string")} { let out = ""; for (const each of list) out += one${n}(each, given) + ";"; return out; }`,
        ],
        [
          `const ask${n} = (list${isTypedList ? `: ${names[0]}[]` : typed("any[]")}, given${any})${typed("string")} => list.map(each => ${says}).join(";");`,
        ],
      ]);

  // What happens between the two askings.
  const some = () => pick(names);
  const late = `Late${n}`;
  const deed = pick([
    "",
    "",
    `${loose(`${some()}.prototype`)}.${name} = function (${lead}given${any}) { return "replaced:" + given; };`,
    `${loose(`${some()}.prototype`)}.${name} = function (${lead}given${any}) { return "replaced:" + given; };`,
    `${loose(`${names[0]}.prototype`)}.${name} = (${lead}given${any}) => "replaced:" + given;`,
    `delete ${loose(`${some()}.prototype`)}.${name};`,
    `delete ${loose(`${names[count - 1]}.prototype`)}.${name};`,
    `${loose(`list${n}[0]`)}.${name} = (${lead}given${any}) => "own:" + given;`,
    `${loose(`list${n}[1]`)}.${name} = (${lead}given${any}) => "own:" + given;`,
    `Object.setPrototypeOf(list${n}[0], ${some()}.prototype);`,
    `Object.setPrototypeOf(${names[count - 1]}.prototype, ${names[0]}.prototype);`,
    `Object.setPrototypeOf(${names[count - 1]}.prototype, { ${name}(${lead}given${any}) { return "hung:" + given; } });`,
    `${loose(`list${n}[0]`)}.v = ${pick(['"text"', "0.5", "null", "{ deep: 1 }"])};`,
    `for (const each of list${n}) ${loose("each")}.v = ${pick(['"text"', "0.5", "7"])};`,
    `${loose(`list${n}[0]`)}.more = 1; delete ${loose(`list${n}[0]`)}.v;`,
    `Object.defineProperty(${some()}.prototype, ${JSON.stringify(name)}, { get() { return (${lead}given${any}) => "got:" + given; }, configurable: true });`,
    `Object.defineProperty(list${n}[0], "v", { get() { return "read"; }, configurable: true });`,
    `class ${late} extends ${loose(some())} { extra = 1; ${name}(${lead}given${any})${any} { return "late:" + given; } }\nlist${n}.push(new ${late}());`,
    `list${n}.push(${loose(pick(others))});`,
    `list${n}.push(${loose(pick(others))});`,
    `list${n}.reverse();`,
  ]);
  const inAFunction = deed && !deed.startsWith("class ") && chance(40);
  const asked = (label: string) =>
    `try { printValue("${label} ${n}", ask${n}(list${n}, ${pick(["1", "1", '"g"', 'JSON.parse("1")', `unknown${n}`, `unknown${n}`])})); } catch (error) { printValue("${label} ${n}", ${loose("error")}.name); }`;
  const written = [
    ...(call.includes(`key${n}`)
      ? [
          `${pick(["const", "let", "var"])} key${n} = ${pick([JSON.stringify(name), JSON.stringify(name), `[${JSON.stringify(name)}].join("")`])};`,
        ]
      : []),
    `const shown${n} = (value${any})${typed("string")} => (typeof value === "function" ? value() + "," + value() : String(value));`,
    `const unknown${n}${any} = ${loose("globalThis")}.swap${n} ?? ((found${any}) => String(found).toUpperCase());`,
    ...classes,
    ...site,
    `const list${n}${isTypedList ? `: ${names[0]}[]` : typed("any[]")} = [${arrives.join(", ")}];`,
    asked("dispatch"),
    ...(chance(30) ? [asked("dispatch")] : []),
    ...(inAFunction
      ? [
          `function change${n}() { ${work} ${deed} return work; }`,
          `try { change${n}(); } catch (error) { printValue("dispatch ${n}", "the deed threw"); }`,
        ]
      : deed
        ? [
            `try { ${deed.includes("\n") ? "" : deed} } catch (error) { printValue("dispatch ${n}", "the deed threw"); }`,
            ...(deed.includes("\n") ? deed.split("\n") : []),
          ].filter(line => line !== `try {  } catch (error) { printValue("dispatch ${n}", "the deed threw"); }`)
        : []),
    asked("dispatch behind"),
    // One call by name beside the site that all share.
    ...(chance(40)
      ? [
          `try { printValue("dispatch by name ${n}", shown${n}(new ${pick(names)}().${name}(${leads}${pick(["1", '"g"'])}))); } catch (error) { printValue("dispatch by name ${n}", ${loose("error")}.name); }`,
        ]
      : []),
  ];
  if (!key) return written;
  const text = JSON.stringify(name);
  return [
    ...(key === `own${n}` ? [`const own${n} = Symbol("own");`] : []),
    ...(key === `text${n}` ? [`const text${n} = ${text};`] : []),
    ...written.map(line =>
      line
        .replaceAll(`[${text}].join("")`, key)
        .replaceAll(`?.${name}?.(`, `?.[${key}]?.(`)
        .replace(new RegExp(`\\.${name}\\b`, "g"), `[${key}]`)
        .replaceAll(`[${text}]`, `[${key}]`)
        .replaceAll(text, key)
        .replace(new RegExp(`(?<![\\w$"\\[])${name}(?=\\(|: | = )`, "g"), `[${key}]`),
    ),
  ];
}
