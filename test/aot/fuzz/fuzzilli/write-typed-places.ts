// TypeScript. A place has a declared type: a field, a variable of the module, a captured variable, a local, an element, a parameter, a result. A value that the type does not allow enters it by a road
// that the checker accepts, and the place is read behind a join, at the head of a loop, behind a call or through a second name. A compiler that takes the declared type for what the place holds
// reads something else than was stored. Everything else in the scene is plain: one place, one road, one way. What is printed are counts of primitives.
type Kind = { type: string; declared: string[]; honest: string; constant: string; json?: string; uses: string[] };
type Place = {
  declared: string[];
  /** What makes the holder, with `turn` in sight. Empty: the place needs no object. */
  make?: string;
  holderType?: string;
  inTurn?: string[];
  store: (value: string) => string;
  read: string;
  /** `.tint` or `[key]`, and the key as an expression, where the place is a property of the holder. */
  member?: string;
  key?: string;
  /** What is read is an answer of the scene's own and not a value of the declared type. */
  isWeighed?: true;
};

export function writeSceneOfTypedPlaces(random: () => number, n: number): string[] {
  const below = (bound: number) => Math.floor(random() * bound);
  const pick = <T>(from: readonly T[]) => from[below(from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const [E, L, C] = [`Tint${n}`, `Lid${n}`, `Crate${n}`];
  const ofNumbers = ["X + 1", "X | 0", "X * 2", "-X", "X === 4 ? 1 : 0", "X > 2", "`${X}`"];
  const members = "{ None = 0, Red = 1, Blue = 2, Gold = 4 }";
  const kinds: Record<string, Kind> = {
    constantEnum: { type: E, declared: [`const enum ${E} ${members}`], honest: `(turn & 7) as ${E}`, constant: `${E}.Red`, json: "4", uses: ofNumbers }, // prettier-ignore
    enum: { type: E, declared: [`enum ${E} ${members}`], honest: `(turn & 7) as ${E}`, constant: `${E}.Red`, json: "4", uses: ofNumbers }, // prettier-ignore
    whole: { type: "number", declared: [], honest: "turn & 7", constant: "3", json: "3", uses: ofNumbers },
    fraction: { type: "number", declared: [], honest: "(turn & 3) + 0.5", constant: "1.25", json: "1.25", uses: ofNumbers }, // prettier-ignore
    flag: { type: "boolean", declared: [], honest: "(turn & 4) === 4", constant: "true", json: "true", uses: ["X ? 1 : 2", "!X", "X === true"] }, // prettier-ignore
    text: { type: "string", declared: [], honest: '"t" + (turn & 3)', constant: '"text"', json: '"text"', uses: ["X.length", 'X + "!"', 'X === "t1"'] }, // prettier-ignore
    literals: {
      type: "1 | 2 | 4",
      declared: [],
      honest: "(turn & 4) ? 1 : 4",
      constant: "2",
      json: "2",
      uses: ofNumbers,
    },
    instance: { type: L, declared: [`class ${L} { weight: number; constructor(weight: number) { this.weight = weight; } }`], honest: `new ${L}(turn & 3)`, constant: `new ${L}(1)`, uses: ["X.weight", "X.weight + 1"] }, // prettier-ignore
    list: { type: "number[]", declared: [], honest: "[turn & 3, 1]", constant: "[1, 2]", json: "[1,2]", uses: ["X.length", "X[0]", "X[0] + 1"] }, // prettier-ignore
    callee: { type: "() => number", declared: [], honest: "(() => turn & 3)", constant: "() => 1", uses: ["X()"] },
  };
  const kind = kinds[pick(["constantEnum", "constantEnum", "enum", "enum", "whole", "whole", "whole", "fraction", "fraction", "flag", "flag", "text", "literals", "instance", "instance", "list", "callee"])]; // prettier-ignore
  const { type: T, honest: H, constant: K } = kind;
  let liar = pick(["undefined", "undefined", "undefined", "undefined", "null", "null", "null", "1.5", "NaN", "-0", "2147483648", "-2147483649", '"4"', '""', "true", "false", "0", "{}", "[]", "7n", '{ weight: "w" }']); // prettier-ignore

  const top: string[] = [...kind.declared];
  const [note, weigh] = [`note${n}`, `weigh${n}`];
  top.push(
    `const counts${n}: Record<string, number> = {};`,
    `function ${note}(text: unknown): void { const key = String(text); counts${n}[key] = (counts${n}[key] ?? 0) + 1; }`,
    `function ${weigh}(value: unknown): string { return value === undefined ? "U" : value === null ? "N" : typeof value === "function" ? "function" : typeof value === "object" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : typeof value + " " + String(value); }`,
  );

  // The road: an expression that the checker takes for a T. While `honestly` holds it is one.
  const roadName = pick(["cast", "cast", "cast", "cast", "any", "any", "unknown", "asserted", "parsed", "generic", "pastTheEnd", "unseen", "optional", "late"]); // prettier-ignore
  if (["pastTheEnd", "optional", "late"].includes(roadName) || (roadName === "asserted" && liar !== "null"))
    liar = "undefined";
  const canBeParsed = kind.json !== undefined && !["NaN", "7n", '{ weight: "w" }'].includes(liar);
  const road = (honestly: string): { before: string[]; value: string; raw: string } => {
    const raw = `(${honestly} ? ${H} : ${liar})`;
    switch (roadName) {
      case "cast":
        return { before: [`const next = ${honestly} ? ${H} : ${liar};`], value: `next as ${T}`, raw };
      case "unknown":
        return { before: [], value: `${raw} as unknown as ${T}`, raw };
      case "asserted":
        return { before: [`const next: ${kind === kinds.callee ? `(${T})` : T} | undefined | null = ${honestly} ? ${H} : ${liar};`], value: "next!", raw }; // prettier-ignore
      case "parsed":
        if (!canBeParsed) break;
        return { before: [], value: `JSON.parse(${honestly} ? ${JSON.stringify(`[${kind.json}]`)} : ${JSON.stringify(liar === "undefined" ? "[]" : `[${liar}]`)})[0]`, raw }; // prettier-ignore
      case "generic":
        return { before: [], value: `pass${n}<${T}>(${raw})`, raw };
      case "pastTheEnd":
        return { before: [`const spare: ${kind === kinds.callee ? `(${T})` : T}[] = [${H}];`], value: `spare[${honestly} ? 0 : 1]`, raw }; // prettier-ignore
      case "unseen":
        return { before: [], value: `unseen${n}(${raw})`, raw };
      case "optional":
        return {
          before: [`const loose: { tint?: ${T} } = ${honestly} ? { tint: ${H} } : {};`],
          value: "loose.tint!",
          raw,
        };
      case "late":
        return { before: [`let late!: ${T};`], value: `${honestly} ? ${H} : late`, raw };
    }
    return { before: [], value: `${raw} as any`, raw };
  };
  if (roadName === "generic") top.push(`function pass${n}<T>(value: unknown): T { return value as T; }`);

  // What is done with what is read. `X` is the read.
  const generic = [
    `${note}(${weigh}(X));`,
    `${note}(${weigh}(X));`,
    `{ const seen: unknown = X; if (seen === undefined || seen === null) holes++; else ${note}(${weigh}(seen)); }`,
    `{ const seen: unknown = X; if (seen === undefined || seen === null) holes++; else ${note}(${weigh}(seen)); }`,
    `if (X === undefined) holes++; else if (X === null) holes += 1000; else ${note}(${weigh}(X));`,
    `${note}(typeof X);`,
    `kept${n} = X; ${note}(${weigh}(kept${n}));`,
    `${note}(${weigh}(echo${n}(X)));`,
  ];
  const useOfType = () => `${note}(${weigh}(${pick(kind.uses)}));`;
  const drawnUse = chance(75) ? pick(generic) : useOfType();

  // The place.
  const classWith = (body: string) => `class ${C} { ${body} }`;
  const property = (declared: string[], make: string, member = ".tint", key = '"tint"'): Place => ({
    declared,
    make,
    holderType: C,
    store: value => `crate${member} = ${value}`,
    read: `crate${member}`,
    member,
    key,
  });
  const places: Record<string, () => Place> = {
    field: () => property([classWith(`tint: ${T}; other: number; constructor(turn: number) { this.tint = ${H}; this.other = turn; }`)], `new ${C}(turn)`), // prettier-ignore
    parameterProperty: () => property([classWith(`constructor(public tint: ${T}, public other: number) {}`)], `new ${C}(${H}, turn)`), // prettier-ignore
    initializer: () => property([classWith(`tint: ${T} = ${K}; other = 0;`)], `new ${C}()`),
    record: () => property([`interface ${C} { tint: ${T}; other: number }`], `{ tint: ${H}, other: turn }`),
    underASymbol: () => property([`const key${n} = Symbol("tint");`, classWith(`[key${n}]: ${T}; constructor(turn: number) { this[key${n}] = ${H}; }`)], `new ${C}(turn)`, `[key${n}]`, `key${n}`), // prettier-ignore
    privateName: () => ({
      declared: [classWith(`#tint: ${T}; constructor(turn: number) { this.#tint = ${H}; } put(value: ${T}): void { this.#tint = value; } get(): ${T} { return this.#tint; }`)], // prettier-ignore
      make: `new ${C}(turn)`,
      holderType: C,
      store: value => `crate.put(${value})`,
      read: "crate.get()",
    }),
    staticField: () => ({ declared: [classWith(`static tint: ${T} = ${K};`)], store: value => `${C}.tint = ${value}`, read: `${C}.tint` }), // prettier-ignore
    variableOfTheModule: () => ({ declared: [`let held${n}: ${T} = ${K};`], store: value => `held${n} = ${value}`, read: `held${n}` }), // prettier-ignore
    captured: () => ({
      declared: [],
      inTurn: [
        `let held: ${T} = ${H};`,
        `const put = (value: ${T}): void => { held = value; };`,
        `const get = (): ${T} => held;`,
      ],
      store: chance(50) ? value => `put(${value})` : value => `held = ${value}`,
      read: "get()",
    }),
    local: () => ({
      declared: [],
      inTurn: [`let held: ${T} = ${H};`],
      store: value => `held = ${value}`,
      read: "held",
    }),
    element: () => ({ declared: [], inTurn: [`const list: ${kind === kinds.callee ? `(${T})` : T}[] = [${H}, ${K}];`], store: value => `list[1] = ${value}`, read: "list[1]" }), // prettier-ignore
    tuple: () => ({ declared: [], inTurn: [`const pair: [${T}, number] = [${H}, turn];`], store: value => `pair[0] = ${value}`, read: "pair[0]" }), // prettier-ignore
    valueOfAMap: () => ({ declared: [], inTurn: [`const map = new Map<number, ${T}>([[1, ${H}]]);`], store: value => `map.set(1, ${value})`, read: `(map.get(1) as ${T})` }), // prettier-ignore
    parameter: () => ({
      declared: [`function take${n}(value: ${T}): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return ${weigh}(${chance(60) ? "value" : pick(kind.uses).replaceAll("X", "value")}); }`], // prettier-ignore
      inTurn: [`let taken = "";`],
      store: value => `taken = take${n}(${value})`,
      read: "taken",
      isWeighed: true,
    }),
    result: () => {
      const { before, value } = road("honestly");
      return {
        declared: [`function give${n}(turn: number, honestly: boolean): ${T} { ${before.join(" ")} return ${value}; }`],
        inTurn: [`let got: ${T} = ${H};`],
        store: () => "",
        read: "got",
      };
    },
  };
  const placeName = pick(["field", "field", "field", "field", "field", "parameterProperty", "initializer", "record", "record", "underASymbol", "privateName", "staticField", "variableOfTheModule", "variableOfTheModule", "captured", "captured", "local", "element", "tuple", "valueOfAMap", "parameter", "parameter", "result", "result"]); // prettier-ignore
  const place = places[placeName]();
  top.push(...place.declared);
  const use = (read: string) => (place.isWeighed ? `${note}(X);` : drawnUse).replaceAll("X", read);
  if (!place.isWeighed && drawnUse.includes(`kept${n}`)) top.push(`let kept${n}: ${T} = ${K};`);
  if (!place.isWeighed && drawnUse.includes(`echo${n}`))
    top.push(`function echo${n}(value: ${T}): ${T} { return value; }`);

  // How the store is spelled. Most are assignments that the checker has seen.
  const spelling = place.member === undefined ? "typed" : pick(["typed", "typed", "typed", "typed", "typed", "typed", "byAnyName", "reflect", "define", "assign", "proxy", "pattern", "deleted", "byAMethod"]); // prettier-ignore
  const storeOf = (honestly: string, holder = "crate"): { before: string[]; store: string } => {
    const { before, value, raw } = road(honestly);
    const target = `${holder}${place.member}`;
    switch (placeName === "result" ? "given" : spelling) {
      case "given":
        return { before: [], store: `got = give${n}(turn, ${honestly})` };
      case "byAnyName":
        return { before: [], store: `(${holder} as any)${place.member} = ${raw}` };
      case "reflect":
        return { before: [], store: `Reflect.set(${holder}, ${place.key}, ${raw})` };
      case "define":
        return { before: [], store: `Object.defineProperty(${holder}, ${place.key}, { value: ${raw}, writable: true, enumerable: true, configurable: true })` }; // prettier-ignore
      case "assign":
        return { before: [], store: `Object.assign(${holder}, { [${place.key}]: ${raw} })` };
      case "proxy":
        return { before, store: `new Proxy(${holder}, {})${place.member} = ${value}` };
      case "pattern":
        return { before, store: `[${target}] = [${value}]` };
      case "deleted":
        return { before: [], store: `${honestly} ? (${target} = ${H}) : delete (${holder} as any)${place.member}` };
      case "byAMethod":
        return { before: [], store: `smear${n}(${holder}, ${raw})` };
    }
    return { before, store: place.store(value).replaceAll("crate", holder) };
  };
  if (spelling === "byAMethod")
    top.push(`function smear${n}(holder: ${C}, value: any): void { holder${place.member} = value; }`);
  if (roadName === "unseen") top.push(`const unseen${n} = (value: any): any => [value][JSON.parse("0")];`);

  // Where the holder comes from.
  const origin = place.make === undefined ? "none" : pick(["fresh", "fresh", "fresh", "once", "parameter", "module"]);
  const annotated = placeName === "record" ? `: ${C}` : "";
  const madeWith = (turn: string) => place.make!.replace(/\bturn\b/g, turn);
  if (origin === "module") top.push(`const crate${n}${annotated} = ${madeWith("1")};`);

  // The way from the store to the read.
  const honestly = pick([
    "(turn & 2) !== 0",
    "(turn & 2) !== 0",
    "turn % 3 !== 0",
    "turn < turns - 1",
    "turn !== 1",
    "false",
  ]);
  const hasHolder = place.make !== undefined;
  const way = pick(["straight", "join", "join", "join", "headOfALoop", "headOfALoop", "reload", "call", "closure", "callback", "handler", "cases", "shortCircuit", ...(hasHolder ? ["secondName", "secondName", "twoParameters"] : []), "awaited"]); // prettier-ignore
  const body: string[] = [];
  const { before, store } = storeOf(honestly);
  const read = place.read;
  switch (way) {
    case "straight":
      body.push(...before, `${store};`, use(read));
      break;
    case "join":
      body.push(...before, `if (turn & 1) ${spelling === "pattern" ? `{ ${store}; }` : `${store};`}`, use(read));
      break;
    case "headOfALoop": {
      const inner = storeOf("(k & 1) !== 0");
      body.push(
        `for (let k = 0; k < 4; k++) {`,
        `  ${use(read)}`,
        ...inner.before.map(line => "  " + line),
        `  ${inner.store};`,
        `}`,
      );
      break;
    }
    case "reload":
      body.push(use(read), ...before, `${store};`, use(read));
      break;
    case "call":
      if (hasHolder && spelling === "typed" && place.member !== undefined) {
        top.push(`function paint${n}(holder: ${C}, value: ${T}): void { holder${place.member} = value; }`);
        body.push(...before, `paint${n}(crate, ${road(honestly).value});`, use(read));
      } else body.push(...before, `${store};`, `idle${n}();`, use(read));
      break;
    case "closure":
      body.push(...before, `const paint = (): void => { ${store}; };`, `if (turn & 1) paint();`, use(read));
      break;
    case "callback":
      body.push(...before, `[turn].forEach(() => { ${store}; });`, use(read));
      break;
    case "handler":
      body.push(
        ...before,
        `try { ${store}; if (turn & 4) throw new Error("left"); holes += 0; } catch { holes += 0; }`,
        use(read),
      );
      break;
    case "cases":
      body.push(
        ...before,
        `switch (turn & 3) { case 1: ${store}; break; case 2: holes += 0; break; default: }`,
        use(read),
      );
      break;
    case "shortCircuit":
      body.push(...before, `(turn & 1) !== 0 && (${store}, true);`, use(read));
      break;
    case "secondName":
      top.push(`const shelf${n}: ${C}[] = [];`);
      body.push(`shelf${n}[0] = crate;`, `const other = shelf${n}[0];`, use(read.replaceAll("crate", "other")), ...before, `${store};`, use(read.replaceAll("crate", "other"))); // prettier-ignore
      break;
    case "twoParameters": {
      const inner = storeOf(honestly, "mine");
      top.push(`function both${n}(mine: ${C}, other: ${C}, turn: number, turns: number): number { let holes = 0; ${use(read.replaceAll("crate", "other"))} ${inner.before.join(" ")} ${inner.store}; ${use(read.replaceAll("crate", "other"))} return holes; }`); // prettier-ignore
      body.push(`holes += both${n}(crate, crate, turn, turns);`);
      break;
    }
    case "awaited":
      body.push(...before, `${store};`, `await null;`, use(read));
      break;
  }
  if (body.some(line => line.includes(`idle${n}()`))) top.push(`function idle${n}(): void { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; }`); // prettier-ignore

  const isAsync = way === "awaited";
  const name = `tally${n}`;
  const lines = [
    ...top,
    `${isAsync ? "async " : ""}function ${name}(turns: number${origin === "parameter" ? `, crate: ${C}` : ""}): ${isAsync ? "Promise<string>" : "string"} {`,
    `  let holes = 0;`,
    ...(origin === "once" ? [`  const crate${annotated} = ${madeWith("turns")};`] : []),
    ...(origin === "module" ? [`  const crate = crate${n};`] : []),
    `  for (let turn = 0; turn < turns; turn++) {`,
    ...(origin === "fresh" ? [`    const crate${annotated} = ${place.make};`] : []),
    ...(place.inTurn ?? []).map(line => "    " + line),
    ...body.map(line => "    " + line),
    `  }`,
    `  return holes + " holes " + JSON.stringify(counts${n});`,
    `}`,
  ];
  // What else the program does with objects of the class decides what the compiler may take for granted of them.
  if (hasHolder && place.member !== undefined)
    lines.push(
      ...pick([
        [],
        [],
        [`function strip${n}(one: ${C}): void { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; delete (one as any)${place.member}; }`, `strip${n}(${madeWith("1")});`], // prettier-ignore
        [`(globalThis as any)[JSON.parse('"kept${n}"')] = [${madeWith("0")}];`],
      ]),
    );
  for (const turns of pick([[4, 400], [4, 400], [300], [3], [1, 2, 64]]))
    lines.push(
      `try { printValue("places ${n}", ${isAsync ? "await " : ""}${name}(${turns}${origin === "parameter" ? `, ${madeWith("1")}` : ""})); } catch (error) { printValue("places ${n} threw", (error as any)?.constructor?.name); }`,
    );
  return lines;
}
