// `let sum = 0; map.forEach((value: number, key: number) => { sum += key + value; });`: a callback that changes variables of
// the function around it. A compiler may copy the callback into the walk behind tests of its declared parameter types and
// keep the variables in registers; a value of another type then takes a seldom used path where the callback is really
// called. The variables must have the same values after either path. Each scene walks clean tables many times and then
// tables whose values or keys break the declared types at the start, in the middle, at the end or everywhere. Some values
// throw, and some run code that looks at the variables through another closure while the walk is under way.
import type { Random } from "./random";

interface Walk {
  table: string;
  /** Makes the table from `values: unknown[]`. */
  made: string;
  /** The walk. `BODY` is the callback's body; it sees `value` and `key`. */
  text: string;
}

const walks: Walk[] = [
  {
    table: "Map<number, number>",
    made: "new Map(values.map((value, at) => [at, value]))",
    text: "table.forEach((value: number, key: number) => {\n    BODY\n  });",
  },
  {
    table: "Map<number, number>",
    made: "new Map(values.map((value, at) => [at, value]))",
    text: "table.forEach((value, key) => {\n    BODY\n  });",
  },
  {
    table: "Map<number, number>",
    made: "new Map(values.map((value, at) => [value, at]))",
    text: "table.forEach((value: number, key: number) => {\n    BODY\n  });",
  },
  {
    table: "Set<number>",
    made: "new Set(values)",
    text: "table.forEach((value: number, key: number) => {\n    BODY\n  });",
  },
  { table: "number[]", made: "values", text: "table.forEach((value: number, key: number) => {\n    BODY\n  });" },
  { table: "number[]", made: "values", text: "table.forEach((value, key) => {\n    BODY\n  });" },
  {
    table: "number[]",
    made: "values",
    text: "answer = table.map((value: number, key: number) => {\n    BODY\n    return value;\n  }).length;",
  },
  {
    table: "number[]",
    made: "values",
    text: "answer = table.filter((value: number, key: number) => {\n    BODY\n    return value > 1;\n  }).length;",
  },
  {
    table: "number[]",
    made: "values",
    text: "answer = table.some((value: number, key: number) => {\n    BODY\n    return value === 400;\n  });",
  },
  {
    table: "number[]",
    made: "values",
    text: "answer = table.findIndex((value: number, key: number) => {\n    BODY\n    return value === 400;\n  });",
  },
  {
    table: "number[]",
    made: "values",
    text: "answer = table.reduce((key: number, value: number) => {\n    BODY\n    return key + 1;\n  }, 0);",
  },
  {
    table: "number[]",
    made: "values",
    text: "answer = Array.from(table, (value: number, key: number) => {\n    BODY\n    return key;\n  }).length;",
  },
  {
    table: "number[]",
    made: "values",
    text: "answer = [...table].sort((value: number, key: number) => {\n    BODY\n    return 0;\n  }).length;",
  },
];

/** Statements of the callback. */
const steps = [
  "sum += key + value;",
  "sum += key + value;",
  "sum += value;",
  "sum += value * key;",
  "count++;",
  "count += step;",
  "last = value;",
  "text += value;",
  "if (value > most) most = value;",
  "kept.push(value);",
  "box.n += value;",
  "bump();",
  "sum = sum + 1;\n    last = sum;",
  'if (typeof value !== "number") throw new TypeError("not a number");',
  "if (key === 2) return undefined as never;",
  "sum -= value;\n    count = count + (value > 2 ? 1 : 0);",
];

const others = [
  '"text"',
  '"7"',
  "null",
  "undefined",
  "true",
  "10n",
  "{ valueOf: () => 2 }",
  "[3]",
  "NaN",
  "-0",
  "1.5",
  "2147483648",
  "Symbol.iterator",
  "{ valueOf: () => (looks.push(String(peek())), 1) }",
  "{ valueOf: () => (looks.push(String(peek())), 1) }",
  "{ valueOf: () => (poke(), 1) }",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const walk = random.pick(walks);
    const isPlain = random.chance(0.4);
    const body = random.sample(isPlain ? steps.slice(0, 7) : steps, random.between(1, 3)).join("\n    ");
    const isSeen = !isPlain && random.chance(0.5);
    const isTried = random.chance(0.5);
    const walked = walk.text.replace("BODY", body);
    const clean = Array.from({ length: random.between(1, 8) }, (unused, at) => String(at + 1));
    const broken = () => {
      const values = [...clean];
      const other = random.pick(others);
      const place = random.pick(["first", "middle", "last", "all", "two"]);
      if (place === "all") return values.map(() => other);
      if (place === "two") values[random.below(values.length)] = random.pick(others);
      values[place === "first" ? 0 : place === "last" ? values.length - 1 : values.length >> 1] = other;
      return values;
    };
    scenes.push(`function table${scene}(values: unknown[]): ${walk.table} {
  return ${walk.made} as unknown as ${walk.table};
}
function walk${scene}(table: ${walk.table}): string {
  let sum = ${random.pick(["0", "0", "0.5", "1"])},
    count = 0,
    last = -1,
    most = 0,
    text = "";
  let answer: unknown;
  const step = 2;
  const kept: number[] = [];
  const box = { n: 0 };
  const bump = () => {
    sum += 1;
  };
  ${isSeen ? 'peek = () => sum + "/" + count + "/" + String(last);\n  poke = () => {\n    sum += 100;\n    count += 100;\n  };' : ""}
  ${isTried ? `try {\n  ${walked}\n  } catch (error) {\n    answer = (error as Error).constructor.name;\n  }` : walked}
  ${random.chance(0.3) ? walked : ""}
  return [typeof sum + String(sum), count, typeof last + String(last), String(most), text, String(answer), kept.length, String(box.n), step].join("|");
}
{
  const answers = new Set<string>();
  for (let round = 0; round < ${random.pick([1, 30, 200])}; round++) answers.add(walk${scene}(table${scene}([${clean.join(", ")}])));
  console.log("scene ${scene}", [...answers].join(" "));
  for (const values of [${Array.from({ length: random.between(2, 5) }, () => `[${broken().join(", ")}]`).join(", ")}, [], [${clean.join(", ")}]]) {
    try {
      console.log("scene ${scene}", walk${scene}(table${scene}(values)), looks.splice(0).join());
    } catch (error) {
      console.log("scene ${scene}", (error as Error).constructor.name, looks.splice(0).join());
    }
  }
}`);
  }
  return `let peek: () => unknown = () => "nothing";
let poke: () => void = () => {};
const looks: string[] = [];
${scenes.join("\n")}
export {};
`;
}
