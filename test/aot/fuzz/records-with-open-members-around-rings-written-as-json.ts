// JSON.stringify is given records that have members of unknown type beside a member whose type names itself, and the value of that member is a ring or is none.
//
//   rings     a record holds a list that holds the record, a record holds the record, a record holds a record that holds a list of the first, a record of lists of unknown that flow alone can type
//   closed    in the typed part after one to sixty steps, in the unknown part by the record itself, a list of it or a record of it, in both, in neither
//   beside    a toJSON that counts, that throws, that answers its holder; a getter; a map with a toJSON and one without; a date; plain values; a value of another type than declared
//   types     unknown, any
//   written   once, twice and three times in one list, as two members of one record, in a list in a list
//   asked     alone, with a replacer function, with a list of names, with an indent
//   from      a try, a function that is handed a closure, a loop, a text that is put together of many answers
//
// Behind each error the ring is taken out, the same call is made again, and the ring is put back. Each call prints its answer or its error, and what ran before it, in order.
import type { Random } from "./random";

const prelude = `export {};
const log: string[] = [];
function note(text: string): void {
  if (log.length < 40) log.push(text);
}
function shown(answer: unknown): string {
  const text = String(answer);
  return text.length > 400 ? text.length + " characters" : text;
}
function print(name: string, answer: unknown): void {
  console.log(name, shown(answer), "|", log.join());
  log.length = 0;
}
function write(name: string, make: () => string | undefined): void {
  try {
    print(name, make());
  } catch (error) {
    print(name, error);
  }
}
class Table extends Map<string, unknown> {
  toJSON(key: string): unknown {
    note("table at " + key);
    return [...this];
  }
}
`;

export function generate(random: Random): string {
  const text: string[] = [prelude];
  const scenes = random.between(2, 4);

  for (let scene = 1; scene <= scenes; scene++) {
    const lines: string[] = [];
    const open = random.pick(["unknown", "any"]);
    const ring = `ring${scene}`;
    const straight = `straight${scene}`;
    const crate = `crate${scene}`;
    let nextId = scene * 100;

    // Every scene has member names of its own, so that no two scenes share a shape.
    const size = `size${scene}`;
    const below = `below${scene}`;
    const form = random.weighted([
      [5, "list"],
      [2, "member"],
      [2, "nested"],
      [3, "lists of unknown"],
    ] as const);
    const steps = random.pick([1, 1, 2, 3, 7, 60]);
    const isTypedPartClosed = random.chance(0.7);
    let ringType = `Ring${scene}`;
    const build = (name: string, isClosed: boolean) => {
      switch (form) {
        case "list":
          lines.push(
            `const ${name}: ${ringType} = { ${size}: 0, ${below}: [] };`,
            `{`,
            `  let last = ${name};`,
            `  for (let step = 1; step < ${steps}; step++) {`,
            `    const next: ${ringType} = { ${size}: step, ${below}: [] };`,
            `    last.${below}.push(next);`,
            `    last = next;`,
            `  }`,
            ...(isClosed ? [`  last.${below}.push(${name});`] : []),
            `}`,
          );
          break;
        case "member":
          lines.push(
            `const ${name}: ${ringType} = { ${size}: 0, ${below}: null };`,
            `{`,
            `  let last = ${name};`,
            `  for (let step = 1; step < ${steps}; step++) {`,
            `    const next: ${ringType} = { ${size}: step, ${below}: null };`,
            `    last.${below} = next;`,
            `    last = next;`,
            `  }`,
            ...(isClosed ? [`  last.${below} = ${name};`] : []),
            `}`,
          );
          break;
        case "nested":
          lines.push(
            `const ${name}: ${ringType} = { ${size}: 0, ${below}: { inner${scene}: [] } };`,
            `{`,
            `  let last = ${name};`,
            `  for (let step = 1; step < ${steps}; step++) {`,
            `    const next: ${ringType} = { ${size}: step, ${below}: { inner${scene}: [] } };`,
            `    last.${below}.inner${scene}.push(next);`,
            `    last = next;`,
            `  }`,
            ...(isClosed ? [`  last.${below}.inner${scene}.push(${name});`] : []),
            `}`,
          );
          break;
        case "lists of unknown":
          lines.push(
            `const ${name}: ${ringType} = { first${scene}: [], second${scene}: [] };`,
            ...(isClosed ? [`${name}.${random.pick(["first", "second"])}${scene}.push(${name});`] : []),
          );
          break;
      }
    };
    switch (form) {
      case "list":
        lines.push(`interface ${ringType} { ${size}: number; ${below}: ${ringType}[] }`);
        break;
      case "member":
        lines.push(`interface ${ringType} { ${size}: number; ${below}: ${ringType} | null }`);
        break;
      case "nested":
        lines.push(`interface ${ringType} { ${size}: number; ${below}: { inner${scene}: ${ringType}[] } }`);
        break;
      case "lists of unknown":
        ringType = "Record<string, unknown[]>";
        break;
    }
    build(ring, isTypedPartClosed);
    build(straight, false);

    const beside = (): string => {
      const id = ++nextId;
      return random.weighted<() => string>([
        [5, () => `{ toJSON() { note("json ${id}"); return ${id}; } }`],
        [2, () => `{ get g() { note("getter ${id}"); return ${id}; } }`],
        [2, () => `{ toJSON() { note("json ${id}"); throw new RangeError("refused ${id}"); } }`],
        [2, () => `{ toJSON() { note("json ${id}"); return ${crate}; } }`],
        [2, () => `new Table([["k", ${id}]])`],
        [1, () => `new Map([["k", ${id}]])`],
        [1, () => "new Date(86400000)"],
        [5, () => random.pick(["1", "2.5", '"text"', "null", "undefined", "true", "[]", "{}", "[1, 2]", '{ k: "v" }'])],
        [2, () => random.pick([ring, `[${ring}]`, `{ deep: ${ring} }`, straight, `[${straight}, ${straight}]`])],
        [1, () => "10n"],
      ])();
    };

    const held = random.weighted([
      [4, "ring"],
      [3, "list of rings"],
      [3, "behind unknown"],
    ] as const);
    const heldType = held === "ring" ? ringType : held === "list of rings" ? `${ringType}[]` : open;
    const heldValue = (value: string) => (held === "ring" ? value : `[${value}]`);
    lines.push(
      `interface Crate${scene} { before${scene}: ${open}; held${scene}: ${heldType}; after${scene}: ${open}; self${scene}: Crate${scene} | null }`,
      `const ${crate}: Crate${scene} = { before${scene}: null, held${scene}: ${heldValue(ring)}, after${scene}: null, self${scene}: null };`,
      `${crate}.before${scene} = ${beside()};`,
      `${crate}.after${scene} = ${beside()};`,
    );
    const closedInOpenPart = random.weighted([
      [6, ""],
      [1, crate],
      [1, `[${crate}]`],
      [1, `{ deep: { deeper: ${crate} } }`],
    ]);
    if (closedInOpenPart) lines.push(`${crate}.${random.pick(["before", "after"])}${scene} = ${closedInOpenPart};`);
    if (random.chance(0.15)) lines.push(`${crate}.self${scene} = ${crate};`);
    if (random.chance(0.15))
      lines.push(`(${crate} as any).held${scene} = ${random.pick(["7", '"stranger"', `{ toJSON() { note("stranger"); return 0; } }`, "null"])};`);

    const calls = random.between(2, 4);
    for (let call = 1; call <= calls; call++) {
      const subject = random.weighted([
        [2, crate],
        [1, `[${crate}]`],
        [4, `[${crate}, ${crate}]`],
        [2, `[${crate}, ${crate}, ${crate}]`],
        [2, `{ a: ${crate}, b: ${crate} }`],
        [1, `[[${crate}], ${crate}]`],
        [1, ring],
        [1, `[${ring}, ${ring}]`],
      ]);
      const rest = random.weighted([
        [7, ""],
        [1, `, (key: string, value: unknown) => { note("replacer " + key); return value; }`],
        [1, `, ["before${scene}", "held${scene}", "after${scene}", "${size}", "${below}", "a", "b", "g", "k"]`],
        [1, `, null, 1`],
        [1, `, null, "\\t"`],
      ]);
      const asked = `JSON.stringify(${subject}${rest})`;
      const name = JSON.stringify(`scene ${scene}, call ${call}`);
      const once = (suffix: string): string[] => {
        const named = suffix ? JSON.stringify(`scene ${scene}, call ${call}, ${suffix}`) : name;
        switch (random.pick(["try", "closure", "loop", "text"] as const)) {
          case "try":
            return [`try { print(${named}, ${asked}); } catch (error) { print(${named}, error); }`];
          case "closure":
            return [`write(${named}, () => ${asked});`];
          case "loop":
            return [`for (let turn = 0; turn < 3; turn++) write(${named} + " turn " + turn, () => ${asked});`];
          case "text":
            return [
              `{`,
              `  let joined = "";`,
              `  for (let turn = 0; turn < 3; turn++) {`,
              `    try { joined += "<" + ${asked} + ">"; } catch (error) { joined += "!" + (error as Error).name; }`,
              `  }`,
              `  print(${named}, joined);`,
              `}`,
            ];
        }
      };
      lines.push(...once(""));
      if (random.chance(0.6)) {
        lines.push(
          `{`,
          `  const kept = ${crate}.held${scene};`,
          `  ${crate}.held${scene} = ${heldValue(straight)};`,
          ...once("without the ring").map(line => "  " + line),
          `  ${crate}.held${scene} = kept;`,
          `}`,
        );
      }
    }
    text.push(lines.join("\n"));
  }
  return text.join("\n") + "\n";
}
