// `let b = x, c = 1n; for (..) c = e; while (c === b && fuel-- > 0) { holder.v; seen.push(b === c); }`: a few variables of one function start as
// values of different kinds, a big integer among them, and are overwritten with each other and with the parameter. They are compared with
// each other, also in the condition of a loop, and an accessor that the loop runs writes some of them. The function is called with arguments
// of two or three kinds. What varies: the first values, which variable is copied into which and where (straight, in a counted loop, behind
// a comparison, by a swap, by the accessor), how they are compared, what is done to them afterwards, and what the calls hand in.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

export function helpers(typed: boolean): string {
  return `function told(ask${typed ? ": () => unknown" : ""})${typed ? ": string" : ""} {
  try {
    return String(ask());
  } catch (error) {
    return (error${typed ? " as Error" : ""}).name;
  }
}
`;
}

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const any = typed ? ": any" : "";
  const locals = ["a", "b", "c", "e"].slice(0, random.between(3, 4));
  const one = () => random.pick(locals);
  const two = () => random.sample(locals, 2) as [string, string];
  // One variable starts as something that is no number. The others mostly start as the parameter.
  const odd = one();
  const others = locals.filter(local => local !== odd);
  const other = () => random.pick(others);
  const first = (local: string) =>
    local === odd
      ? random.pick(["1n", "1n", "1n", '"s"', '"s"', "0n", "null", "undefined", "true", "{}"])
      : random.chance(0.85)
        ? "x"
        : random.pick(["0", "1.5", '"s"']);
  const mostly = (likely: string) => (random.chance(0.85) ? likely : one());
  const compared = (l: string, r: string) => random.weighted([
    [10, `${l} === ${r}`],
    [2, `${l} !== ${r}`],
    [1, `${l} == ${r}`],
    [1, `Object.is(${l}, ${r})`],
    [1, `typeof ${l} === typeof ${r}`],
  ] as const); // prettier-ignore
  const [written, read] = two();
  const [stored] = two();
  const holder = random.weighted([
    [14, `const holder = { get v() { ${written} = ${read}; return 1; } };`],
    [2, `const holder = { get v() { ${written} = ${read}; return 1; }, set v(w${any}) { ${stored} = w; } };`],
    [1, `const holder = { get v() { [${written}, ${read}] = [${read}, ${written}]; return 1; } };`],
    [2, ""],
  ] as const);
  const runs = holder ? "holder.v; " : "";
  const statement = () => {
    const [l, r] = two();
    return random.weighted([
      [4, `for (let i = 0; i < n; i++) ${l} = ${r};`],
      [4, `${name}T.push(${compared(l, r)});`],
      [5, `while (${l} === ${r} && fuel-- > 0) { ${runs}${name}T.push(${compared(r, l)}); }`],
      [2, `while (${l} !== ${r} && fuel-- > 0) { ${runs}${l} = ${r}; }`],
      [2, `if (${compared(l, r)}) ${l} = ${one()}; else ${r} = ${one()};`],
      [2, `${l}++;`],
      [1, `${l} = ${l} + 1;`],
      [2, `${l} = ${r};`],
      [1, `[${l}, ${r}] = [${r}, ${l}];`],
      [holder.includes("set v") ? 2 : 0, `holder.v = ${l};`],
      [holder ? 1 : 0, "holder.v;"],
      [1, `do { ${runs}${name}T.push(${compared(l, r)}); } while (${l} === ${r} && fuel-- > 0);`],
    ] as const);
  };
  // The parts in the order in which they lean on each other: a copy in a counted loop, a comparison, a loop on a comparison that runs the
  // accessor and compares again, arithmetic on a variable. Each is mostly there, other statements stand between them.
  const inLoop = mostly(odd);
  const against = mostly(other());
  const parts = [
    `for (let i = 0; i < n; i++) ${inLoop} = ${mostly(other())};`,
    `${name}T.push(${compared(...two())});`,
    `while (${inLoop} === ${against} && fuel-- > 0) { ${runs}${name}T.push(${compared(against, inLoop)}); }`,
    `${mostly(against)}++;`,
  ];
  const body = parts.flatMap(part => [
    ...(random.chance(0.1) ? [statement()] : []),
    ...(random.chance(0.93) ? [part] : []),
  ]);
  const answer = random.chance(0.7)
    ? `${other()} + 1`
    : random.pick([`typeof ${one()}`, `String(${one()})`, `${one()}`, compared(...two())]);
  const text = `const ${name}T${typed ? ": unknown[]" : ""} = [];
function ${name}(x${any}, n${typed ? ": number" : ""}) {
  let fuel = 3;
  let ${locals.map(local => `${local}${any} = ${first(local)}`).join(", ")};
  ${holder}
  ${body.join("\n  ")}
  return ${answer};
}
`;
  const kinds = random.chance(0.7)
    ? ["1", '"a"', ...random.sample(["1n", "1.5", "null", "{}"], random.between(0, 1))]
    : random.sample(["1", '"a"', "1n", "1.5", "null", "{}", "undefined", "0", "NaN", "true"], random.between(2, 3));
  const calls = kinds.map(kind => `told(() => ${name}(${kind}, ${random.pick([0, 1, 2, 2, 3])}))`);
  return { name, text, calls: [...calls, `${name}T.join()`] };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(2, 5) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
