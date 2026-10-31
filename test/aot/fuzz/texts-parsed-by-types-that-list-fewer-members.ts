// `JSON.parse(text) as T` where the text has members that T does not list. The members stay on the object, in their places among the keys, as plain Bun has them.
// A program is one type, one group of texts and one use of the results. Every text is parsed several times, so that what the run time remembers of a text is used too.
export const types = {
  "one name": ["{ name: string }", [["name", '"row"']]],
  "a number and a name": [
    "{ id: number; name: string }",
    [
      ["id", "7"],
      ["name", '"row"'],
    ],
  ],
  "two optional members": [
    "{ name?: string; id?: number }",
    [
      ["name", '"row"'],
      ["id", "7"],
    ],
  ],
  "three kinds": [
    "{ a: number; b: string; c: boolean }",
    [
      ["a", "1"],
      ["b", '"two"'],
      ["c", "true"],
    ],
  ],
  "a list of strings": [
    "{ name: string; tags: string[] }",
    [
      ["name", '"row"'],
      ["tags", '["x","y"]'],
    ],
  ],
  "an object inside": [
    "{ name: string; inner: { x: number } }",
    [
      ["name", '"row"'],
      ["inner", '{"x":1,"more":2}'],
    ],
  ],
  "an unknown member": [
    "{ name: string; v: unknown }",
    [
      ["name", '"row"'],
      ["v", '{"deep":[1,{"er":2}]}'],
    ],
  ],
  "members that may be null": [
    "{ name: string | null; n: number | null }",
    [
      ["name", "null"],
      ["n", "2.5"],
    ],
  ],
  "minus zero": [
    "{ n: number; name: string }",
    [
      ["n", "-0"],
      ["name", '"row"'],
    ],
  ],
  "a list of objects": [
    "{ name: string; rows: { id: number }[] }",
    [
      ["name", '"row"'],
      ["rows", '[{"id":1},{"id":2,"more":true}]'],
    ],
  ],
  "one of two texts": [
    '{ kind: "a" | "b"; name: string }',
    [
      ["kind", '"a"'],
      ["name", '"row"'],
    ],
  ],
} as const satisfies Record<string, readonly [string, readonly (readonly [string, string])[]]>;
export type TypeName = keyof typeof types;
export const typeNames = Object.keys(types) as TypeName[];

type Member = readonly [string, string];

const others: Member[] = [
  ["x", "1"],
  ["y", '"why"'],
  ["z", "false"],
  ["w", "null"],
  ["f", "1.5"],
  ["big", "12345678901234567890"],
  ["e", "1e3"],
  ["neg", "-17"],
  ["o", '{"p":1,"q":[2,3]}'],
  ["l", '[1,"2",null,{"a":1}]'],
  ["s", '"a\\nb\\u0041\\"c"'],
  ["u", '"é日本"'],
  ["long_text", `"${"abcdefghij".repeat(9)}"`],
  ["empty", '""'],
  ["eo", "{}"],
  ["ea", "[]"],
  ["one", '"q"'],
];

const oddNames: Member[] = [
  ["__proto__", '{"polluted":1}'],
  ["0", '"zero"'],
  ["10", '"ten"'],
  ["2", "2"],
  ["", '"no name"'],
  ["constructor", "1"],
  ["toString", '"ts"'],
  ["hasOwnProperty", "3"],
  ["a_key_that_is_longer_than_thirty_two_bytes_long", "1"],
  ["exactly_twenty_nine_characters", "1"],
  ["é", "1"],
  ["日本", "2"],
  ["with space", "1"],
  ["length", "5"],
  ["4294967295", "1"],
  ["4294967294", "1"],
  ["-1", "1"],
  ["01", "1"],
  ["1.5", "1"],
];

function written(members: readonly Member[], separator = ",", colon = ":", open = "{", close = "}") {
  return open + members.map(([name, value]) => JSON.stringify(name) + colon + value).join(separator) + close;
}

export const groups = {
  "in every place": declared =>
    [1, 2, 3, 5, 9, 17].flatMap(count => {
      const more = others.slice(0, count);
      const half = count >> 1;
      const byTurns: Member[] = [];
      for (let i = 0; i < Math.max(declared.length, count); i++) {
        if (i < count) byTurns.push(more[i]);
        if (i < declared.length) byTurns.push(declared[i]);
      }
      return [
        written([...more, ...declared]),
        written([...declared, ...more]),
        written([declared[0], ...more, ...declared.slice(1)]),
        written([...more.slice(0, half), declared[0], ...more.slice(half), ...declared.slice(1)]),
        written(byTurns),
        written([...declared].reverse().concat(more)),
        written([more[0], ...[...declared].reverse()]),
      ];
    }),
  "under odd names": declared =>
    oddNames.flatMap(odd => [
      written([odd, ...declared]),
      written([...declared, odd]),
      written([declared[0], odd, others[0], ...declared.slice(1)]),
    ]),
  "that come again": declared => [
    written([...declared, ...declared]),
    written([others[0], ...declared, [others[0][0], '"again"']]),
    written([others[0], [others[0][0], "2"], ...declared]),
    written([declared[0], others[0], declared[0], ...declared.slice(1)]),
    written([others[0], ...declared, [declared[0][0], '"other"']]),
    written([others[0], ...declared, [declared[0][0], "99"]]),
    written([others[0], others[1], ...declared, others[1], others[0]]),
  ],
  "with escapes in names": declared => {
    const [name, value] = declared[0];
    const rest = written(declared).slice(1);
    const escaped = `"\\u00${name.charCodeAt(0).toString(16).padStart(2, "0")}${name.slice(1)}":${value}`;
    return [
      `{"x":1,${escaped}${declared
        .slice(1)
        .map(([other, its]) => `,${JSON.stringify(other)}:${its}`)
        .join("")}}`,
      `{"\\u0078":1,${rest}`,
      `{"x\\ty":1,${rest}`,
      `{"x\\"y":1,${rest}`,
      `{"x":1,${rest.slice(0, -1)},"\\u0078":2}`,
    ];
  },
  "with white space": declared => {
    const members = [...others.slice(0, 2), ...declared, ...others.slice(2, 4)];
    return [
      written(members, ", ", ": ", "{ ", " }"),
      written(members, ",\n  ", ": ", "{\n  ", "\n}"),
      written(members, " ,\t", " : ", "\r\n{", "}\n"),
      written(members, ",", " :"),
    ];
  },
  "that are not as the type says": declared => {
    const good = written([...others.slice(0, 2), ...declared]);
    const open = good.slice(0, -1);
    return [
      written(others.slice(0, 2)),
      written([others[0], ...declared.slice(1)]),
      written([others[0], [declared[0][0], '{"not":"it"}'], ...declared.slice(1)]),
      written([others[0], [declared[0][0], "[1]"], ...declared.slice(1)]),
      written([others[0], [declared[0][0], "true"], ...declared.slice(1)]),
      open,
      `${open},}`,
      `${good}x`,
      `${open},"t"}`,
      `${open},"t":}`,
      `${open},"t":01}`,
      `${open},"t":"\\x"}`,
      `${open},t:1}`,
      good.replace(",", ",,"),
      good.replace(":", ""),
      `{"x":1 "y":2,${written(declared).slice(1)}`,
      `${open},"t":tru}`,
      `${open},"t":nul}`,
      `${open},"t":-}`,
      `${open},"t":1.}`,
      `${open},"t":"unterminated}`,
      "{}",
      "{ }",
      "null",
      "[]",
      "7",
      '"s"',
    ];
  },
  "in great number": declared =>
    [30, 62, 63, 64, 65, 70, 130, 300].flatMap(count => {
      const many = Array.from({ length: count }, (_, i): Member => [`k${i}`, String(i)]);
      return [
        written([...many.slice(0, count >> 1), ...declared, ...many.slice(count >> 1)]),
        written([...declared, ...many]),
      ];
    }),
  "whose values change under the same names": declared =>
    [
      "1",
      "2",
      "-1",
      "1.5",
      "1e21",
      "12345678901",
      "0",
      "-0",
      '"text"',
      '"other text"',
      '"a\\nb"',
      `"${"long".repeat(20)}"`,
      '""',
      "true",
      "false",
      "null",
      "{}",
      '{"x":1}',
      "[]",
      "[1]",
      '["a"]',
    ].flatMap(value => [
      written([["x", value], ...declared, ["y", value]]),
      ...declared.map((_, changed) =>
        written([
          ["x", "1"],
          ...declared.map(([name, its], i): Member => [name, i === changed ? value : its]),
          ["y", '"why"'],
        ]),
      ),
    ]),
} as const satisfies Record<string, (declared: readonly Member[]) => string[]>;
export type Group = keyof typeof groups;
export const groupNames = Object.keys(groups) as Group[];

export const uses = [
  "all is shown",
  "by turns, with collections between",
  "nothing lists the keys",
  "in lists",
  "inside another object",
  "through a reviver",
  "written again in many ways",
] as const;
export type Use = (typeof uses)[number];

const shows = `function show(label: string, make: () => unknown): void {
  let line: string;
  try {
    line = String(make());
  } catch (e) {
    line = "throws " + (e as Error).name + ": " + (e as Error).message;
  }
  console.log(label + " " + line);
}
function dump(o: any): void {
  show("json", () => JSON.stringify(o));
  if (o === null || typeof o !== "object") return;
  show("keys", () => Object.keys(o).join("|"));
  show("forin", () => {
    const k: string[] = [];
    for (const n in o) k.push(n);
    return k.join("|");
  });
  show("entries", () => JSON.stringify(Object.entries(o)));
  show("values", () => JSON.stringify(Object.values(o)));
  show("spread", () => JSON.stringify({ ...o }));
  show("assign", () => JSON.stringify(Object.assign({ first: 0 }, o)));
  show("names", () => Object.getOwnPropertyNames(o).join("|"));
  show("own", () => Reflect.ownKeys(o).map(String).join("|"));
  show("proto", () => Object.getPrototypeOf(o) === Object.prototype || Array.isArray(o));
  show("polluted", () => o.polluted + " " + ({} as any).polluted);
  show("in", () => ["x", "name", "id", "__proto__", "0", "nope", "toString"].map(k => k in o).join());
  show("has", () => ["x", "name", "id", "__proto__", "0", "nope", "toString"].map(k => Object.prototype.hasOwnProperty.call(o, k)).join());
  show("descriptors", () => JSON.stringify(Object.getOwnPropertyDescriptors(o)));
  show("byname", () => [o.x, o.y, o.name, o.id, o.k0, o.k61, o[0], o["10"]].map(v => JSON.stringify(v)).join());
  show("zero", () => Object.is(o.n, -0) + " " + Object.is(o.neg, -17));
  show("delete", () => {
    delete o.x;
    delete o.name;
    return Object.keys(o).join("|") + " " + JSON.stringify(o);
  });
  show("add", () => {
    o.x = "back";
    o.late = 1;
    o.name = "again";
    return Object.keys(o).join("|") + " " + JSON.stringify(o);
  });
  show("frozen", () => {
    Object.freeze(o);
    return Object.isFrozen(o) + " " + JSON.stringify(o);
  });
}
`;

export function generate(typeName: TypeName, group: Group, use: Use) {
  const [type, declared] = types[typeName];
  const texts = groups[group](declared);
  const objects = texts.filter(text => text.startsWith("{") && text.endsWith("}"));
  const head = (list: string[]) => `${shows}type T = ${type};\nconst texts: string[] = ${JSON.stringify(list)};\n`;
  const caught = 'console.log("throws " + (e as Error).name + ": " + (e as Error).message);';
  let text: string;
  switch (use) {
    case "all is shown":
      text = `${head(texts)}for (const text of texts) {
  console.log("TEXT " + text.slice(0, 200));
  for (let r = 0; r < 4; r++) {
    try {
      dump(JSON.parse(text) as T);
    } catch (e) {
      ${caught}
    }
  }
}
`;
      break;
    case "by turns, with collections between":
      text = `${head(texts)}for (let r = 0; r < 5; r++) {
  for (const text of texts) {
    try {
      const o = JSON.parse(text) as T;
      show("json", () => JSON.stringify(o));
      show("keys", () => Object.keys((o as object) ?? {}).join("|"));
    } catch (e) {
      ${caught}
    }
  }
  if (r & 1) Bun.gc(true);
}
`;
      break;
    case "nothing lists the keys":
      text = `type T = ${type};
const texts: string[] = ${JSON.stringify(texts)};
let s = "";
for (const text of texts) {
  for (let r = 0; r < 4; r++) {
    try {
      const o = JSON.parse(text) as T;
      s += String(o?.${declared[0][0]}) + "," + String((o as any)?.x) + "," + String((o as any)?.k61) + ";";
    } catch (e) {
      s += "!" + (e as Error).message + ";";
    }
  }
  s += "\\n";
}
console.log(s);
`;
      break;
    case "in lists":
      text = `${head([
        ...objects.map((_, i) => `[${[0, 1, 2, 1, 0].map(step => objects[(i + step) % objects.length]).join(",")}]`),
        ...objects
          .slice(0, 3)
          .flatMap(object => [
            `[${object},${object},${object}]`,
            `[ ${object} , ${object} ]`,
            `[${object},]`,
            `[${object},${object},]`,
            `[${object} ${object}]`,
            `[${object},,${object}]`,
            `[${object},null,${object}]`,
            `[${object},1,${object}]`,
            `[${object},[${object}]]`,
            `[${object},${object}`,
            `[${object},${object}}`,
            `[${object},${object}]]`,
          ]),
      ])}for (const text of texts) {
  for (let r = 0; r < 3; r++) {
    try {
      const list = JSON.parse(text) as T[];
      console.log(list.length);
      show("list", () => JSON.stringify(list));
      show("holder", () => JSON.stringify({ list, first: list[0], count: list.length }));
      for (const o of list) {
        show("json", () => JSON.stringify(o));
        show("keys", () => Object.keys((o as object) ?? {}).join("|"));
        show("spread", () => JSON.stringify({ ...o }));
      }
    } catch (e) {
      ${caught}
    }
  }
}
`;
      break;
    case "inside another object":
      text = `${head(objects.map((object, i) => `{"before":1,"first":${object},"between":[2],"second":${objects[(i + 1) % objects.length]},"after":"3"}`))}type P = { first: T; second: T };
for (const text of texts) {
  for (let r = 0; r < 3; r++) {
    try {
      const p = JSON.parse(text) as P;
      show("whole", () => JSON.stringify(p));
      show("parts", () => JSON.stringify([p.first, p.second]));
      dump(p);
      dump(p.first);
      dump(p.second);
    } catch (e) {
      ${caught}
    }
  }
}
`;
      break;
    case "through a reviver":
      text = `${head(texts)}for (const text of texts) {
  for (let r = 0; r < 3; r++) {
    try {
      const seen: string[] = [];
      const o = JSON.parse(text, function (k, v) {
        seen.push(k);
        return typeof v === "number" ? v + 1 : k === "y" ? undefined : v;
      }) as T;
      console.log(seen.join("|"));
      show("json", () => JSON.stringify(o));
      show("keys", () => Object.keys((o as object) ?? {}).join("|"));
    } catch (e) {
      ${caught}
    }
  }
}
`;
      break;
    case "written again in many ways":
      text = `${head(texts)}function write(o: any): void {
  show("plain", () => JSON.stringify(o));
  show("indented", () => JSON.stringify(o, null, 2));
  show("in a list", () => JSON.stringify([o, o]));
  show("in a holder", () => JSON.stringify({ a: o, b: [o] }));
  show("by a function", () => JSON.stringify(o, (k, v) => (typeof v === "number" ? v + 1 : v)));
  show("by names", () => JSON.stringify(o, ["x", "name", "y"]));
  if (o === null || typeof o !== "object") return;
  const values: [string, unknown][] = [
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["undefined", undefined],
    ["a bigint", 10n],
    ["a wide text", "\\u65e5\\u672c"],
    ["a text with escapes", 'a"b\\\\c\\n'],
    ["no number", NaN],
    ["no finite number", -Infinity],
    ["minus zero", -0],
    ["a fraction", 0.1],
    ["a date", new Date(0)],
    ["an object", { deep: [1, { er: 2 }] }],
    ["an object that writes itself", { toJSON: () => "T" }],
    ["null", null],
  ];
  for (const [label, value] of values) {
    show("x is " + label, () => {
      o.x = value;
      return JSON.stringify(o);
    });
    show("late is " + label, () => {
      o.late = value;
      return JSON.stringify(o);
    });
  }
  show("a name longer than a block", () => {
    o.a_name_that_is_longer_than_sixteen_bytes = 1;
    return JSON.stringify(o);
  });
  show("a name with an escape", () => {
    o['q"q'] = 1;
    return JSON.stringify(o);
  });
  show("a wide name", () => {
    o["\\u65e5"] = 1;
    return JSON.stringify(o);
  });
  show("toJSON of its own", () => {
    o.toJSON = () => "own";
    return JSON.stringify(o) + JSON.stringify([o]);
  });
  show("toJSON that is no function", () => {
    o.toJSON = 1;
    return JSON.stringify(o);
  });
  show("toJSON removed", () => {
    delete o.toJSON;
    return JSON.stringify(o);
  });
  show("a getter", () => {
    Object.defineProperty(o, "got", { get: () => 7, enumerable: true, configurable: true });
    return JSON.stringify(o);
  });
  show("a hidden member", () => {
    Object.defineProperty(o, "hid", { value: 8, enumerable: false });
    return JSON.stringify(o);
  });
  show("an index", () => {
    o[3] = "three";
    return JSON.stringify(o);
  });
  show("toJSON above", () => {
    Object.setPrototypeOf(o, { toJSON: () => "above" });
    try {
      return JSON.stringify(o) + JSON.stringify([o]);
    } finally {
      Object.setPrototypeOf(o, Object.prototype);
    }
  });
  show("at last", () => JSON.stringify(o));
}
for (const text of texts) {
  for (let r = 0; r < 3; r++) {
    try {
      write(JSON.parse(text) as T);
    } catch (e) {
      ${caught}
    }
  }
}
`;
      break;
  }
  return { file: "program.ts", text };
}
