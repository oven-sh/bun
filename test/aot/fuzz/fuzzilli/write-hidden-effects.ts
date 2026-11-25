// TypeScript. An operation runs code of the program where no call is written: the lookup of a method finds a getter, a member is an accessor, a proxy answers, an operand is converted, a key is made a text,
// a list is spread. That code writes a variable which a neighbor in the same expression reads: `figure.area(tally)`, where looking `area` up adds to `tally`. The language says which of the two comes first.
// Everything else is plain: most receivers are ordinary instances of two or three classes behind one interface, and the odd one comes seldom.
export function writeSceneOfHiddenEffects(random: () => number, n: number): string[] {
  const below = (bound: number) => Math.floor(random() * bound);
  const pick = <T>(from: readonly T[]) => from[below(from.length)];
  const chance = (percent: number) => random() * 100 < percent;

  // What is read beside the operation, and written by the hidden code.
  const kindOfVariable = pick([
    "var",
    "var",
    "var",
    "var",
    "let",
    "let",
    "field",
    "element",
    "static",
    "captured",
    "captured",
  ]);
  const type = chance(80) ? "number" : "any";
  const [declared, R] = {
    var: [`var tally${n}: ${type} = 0;`, `tally${n}`],
    let: [`let tally${n}: ${type} = 0;`, `tally${n}`],
    captured: [`let tally${n}: ${type} = 0;`, `tally${n}`],
    field: [`const box${n}: { tally: ${type} } = { tally: 0 };`, `box${n}.tally`],
    element: [`const cells${n}: ${type}[] = [0, 0];`, `cells${n}[1]`],
    static: [`class Count${n} { static tally: ${type} = 0; }`, `Count${n}.tally`],
  }[kindOfVariable]!;
  const effect = pick([`${R} += 5;`, `${R} += 5;`, `${R} += 5;`, `${R}++;`, `${R} = ${R} * 2 + 1;`, `${R} = -${R} - 1;`, `${R} += 0.5;`, ...(type === "any" ? [`${R} = "t" + ${R};`, `${R} = undefined;`] : [])]); // prettier-ignore

  const [Figure, Plate, Board, Ghost] = [`Figure${n}`, `Plate${n}`, `Board${n}`, `Ghost${n}`];
  const lines = [
    declared,
    `interface ${Figure} { area(n: number, m?: number): number; side: number }`,
    `class ${Plate} implements ${Figure} { constructor(readonly side: number) {} area(n: number, m = 0) { return this.side * 1000 + n + m; } }`,
    `class ${Board} implements ${Figure} { constructor(readonly side: number) {} area(n: number, m = 0) { return this.side * 1000 + n - m; } }`,
  ];
  // The receiver at which the lookup runs code.
  const odd = pick(["getter", "getter", "getter", "laidAbove", "laidAbove", "laidOn", "proxy", "below"]);
  let made = `new ${Ghost}(4)`;
  let late = "";
  const answer = `(n: number, m = 0) => 4000 + n + m`;
  if (odd === "getter")
    lines.push(`class ${Ghost} implements ${Figure} { constructor(readonly mist: number) {} get area() { ${effect} const mist = this.mist; return (n: number, m = 0) => mist * 1000 + n + m; } get side() { ${effect} return this.mist; } }`); // prettier-ignore
  else if (odd === "laidAbove") {
    made = `new ${Board}(4)`;
    late = `Object.defineProperty(${Board}.prototype, "area", { get() { ${effect} return ${answer}; }, configurable: true });`;
  } else if (odd === "laidOn")
    made = `Object.defineProperties(new ${Plate}(4), { area: { get() { ${effect} return ${answer}; } }, side: { get() { ${effect} return 4; } } })`;
  else if (odd === "proxy")
    made = `new Proxy(new ${Plate}(4), { get(target, key, receiver) { ${effect} return Reflect.get(target, key, receiver); } })`;
  else
    made = `Object.setPrototypeOf({}, { get area() { ${effect} return ${answer}; }, get side() { ${effect} return 4; } }) as ${Figure}`;

  // What is converted, made a key, spread or asked.
  const helpers = [
    `const thing${n}: any = { [Symbol.toPrimitive]() { ${effect} return 3; } };`,
    `const walker${n}: Iterable<number> = { *[Symbol.iterator]() { ${effect} yield 7; } };`,
    `const table${n}: Record<string, (n: number) => number> = { 3: n => n + 30 };`,
    `class Odd${n} { static [Symbol.hasInstance]() { ${effect} return true; } }`,
    `function take${n}(...all: unknown[]): string { return all.join(); }`,
  ];
  const [thing, walker, table] = [`thing${n}`, `walker${n}`, `table${n}`];
  const form = pick([
    `figure.area(${R})`,
    `figure.area(${R})`,
    `figure.area(${R})`,
    `figure.area(${R})`,
    `figure.area(${R})`,
    `figure.area(${R})`,
    `figure.area(${R})`,
    `figure.area(${R})`,
    `figure["area"](${R})`,
    `figure.area(${R}, ${R})`,
    `figure.area(${R}, ${R})`,
    `figure.area(${R}) + ${R}`,
    `${R} + figure.area(${R})`,
    `figure.area?.(${R})`,
    `figure["area"](${R})`,
    `figure[name](${R})`,
    `figure.area.call(figure, ${R})`,
    `figure.area(figure.side, ${R})`,
    `figure.side + ${R}`,
    `${R} + figure.side`,
    `${R} + figure.side + ${R}`,
    `[${R}, figure.side, ${R}].join()`,
    `\`\${${R}}|\${figure.side}|\${${R}}\``,
    `take${n}(${R}, figure.side, ${R})`,
    `JSON.stringify({ a: ${R}, b: figure.side, c: ${R} })`,
    `Math.max(${R}, figure.side, ${R})`,
    `(${R} < figure.side) + "," + ${R}`,
    `(${R} += figure.side)`,
    `${R} + ${thing}`,
    `${thing} + ${R}`,
    `${R} * ${thing} + ${R}`,
    `\`\${${R}}|\${${thing}}|\${${R}}\``,
    `take${n}(${R}, ${table}[${thing}](${R}), ${R})`,
    `${table}[${thing}](${R})`,
    `take${n}(${R}, ${thing} < ${R}, ${R})`,
    `Math.max(${R}, ${thing}, ${R})`,
    `take${n}(${R}, ...${walker}, ${R})`,
    `[${R}, ...${walker}, ${R}].join()`,
    `take${n}(${R}, figure instanceof Odd${n}, ${R})`,
    `(${R} += ${thing})`,
  ]);
  // Only what the expression names: a writer that nothing reaches is still a writer in sight.
  lines.push(...helpers.filter(line => form.includes(/^(?:const|class|function) (\w+)/.exec(line)![1])));
  const work = chance(75)
    ? ["  let work = 0;", "  for (let i = 0; i < 2; i++) work = (work + i) | 0;"]
    : ["  const work = 0;"];
  const turns = pick([3, 6, 6, 300]);
  lines.push(
    `function probe${n}(figure: ${Figure}): string {`,
    ...work,
    ...(form.includes("[name]") ? [`  const name = "area";`] : []),
    `  const got = ${form};`,
    `  return got + ":" + work;`,
    `}`,
    `const figures${n}: ${Figure}[] = [new ${Plate}(2), new ${Board}(3), ${made}];`,
    `let out${n} = "";`,
    `for (let turn = 0; turn < ${turns}; turn++) {`,
    ...(late ? [`  if (turn === ${pick([0, turns - 3, turns - 1])}) ${late}`] : []),
    `  const said = probe${n}(figures${n}[${pick(["turn % 3", "turn % 3", `turn < ${turns - 1} ? turn & 1 : 2`])}]);`,
    `  if (turn < 6 || turn > ${turns - 4}) out${n} += said + ";";`,
    `}`,
    `printValue("hidden ${n}", out${n}, String(${R}));`,
  );
  return kindOfVariable === "captured"
    ? [`function scene${n}(): void {`, ...lines.map(line => "  " + line), `}`, `scene${n}();`]
    : lines;
}
