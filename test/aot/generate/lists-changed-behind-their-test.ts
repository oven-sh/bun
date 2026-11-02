// The programs of lists-changed-behind-their-test. `bun test/aot/generate.ts lists-changed-behind-their-test <where>` writes them.
// A loop that runs often asks once what kind of storage a list has and how long it is, ahead of its turns where it can. Each program here changes the storage or the length
// between such a question and a read or a store of an element: what a turn reads and writes is what plain Bun reads and writes.
// One change, one place for it and one kind of list a program, so that what the compiler knows about the list is as narrow as it gets.
import { programsOf } from "../generate";
import { lists as shapedForOneWayToMove } from "./what-is-moved-ahead-of-a-loop";

type Kind = {
  /** The type of the list. */
  type: string;
  /** What stands ahead of everything else. */
  declarations?: string;
  /** An expression: a new list of eight elements. */
  make: string;
  /** An expression: another list, of another length or kind, that fits the type. */
  other: string;
  /** An expression of `e`, an element or undefined: a number. */
  value: string;
  /** An expression of `n`, a number: a new element. */
  fresh: string;
  isTypedArray?: boolean;
  /** Its buffer can be resized. */
  isResizable?: boolean;
  /** Which kinds of elements it takes without a cast. */
  holds: "numbers" | "texts" | "objects" | "bigints";
};

const bytes = (type: string, size: number, spelled: (buffer: string) => string, isResizable: boolean): Kind => ({
  type,
  declarations: `function filled(list: ${type}): ${type} {\n  for (let i = 0; i < list.length; i++) list[i] = ${type.startsWith("Big") ? "BigInt(i * 3 + 1)" : "i * 3 + 1"};\n  return list;\n}`,
  make: `filled(${spelled(isResizable ? `new ArrayBuffer(${12 * size}, { maxByteLength: ${64 * size} })` : `new ArrayBuffer(${12 * size})`)})`,
  other: `filled(new ${type}(3))`,
  value: type.startsWith("Big") ? "e === undefined ? -1000 : Number(e)" : "e === undefined ? -1000 : e",
  fresh: type.startsWith("Big") ? "BigInt(n)" : "n",
  isTypedArray: true,
  isResizable,
  holds: type.startsWith("Big") ? "bigints" : "numbers",
});

const kinds: Record<string, Kind> = {
  "integers": {
    type: "number[]",
    make: "[3, 1, 4, 1, 5, 9, 2, 6]",
    other: "[70, 71, 72]",
    value: "e === undefined ? -1000 : e",
    fresh: "n",
    holds: "numbers",
  },
  "fractions": {
    type: "number[]",
    make: "[3.5, 1.25, 4.5, 1.75, 5.5, 9.25, 2.5, 6.125]",
    other: "[70.5, 71.5, 72.5]",
    value: "e === undefined ? -1000 : e",
    fresh: "n + 0.5",
    holds: "numbers",
  },
  "texts": {
    type: "string[]",
    make: '["three", "one", "four", "uno", "five", "nine", "two", "six"]',
    other: '["seventy", "more", "most"]',
    value: "e === undefined ? -1000 : e.length * 7 + e.charCodeAt(0)",
    fresh: '"n" + n',
    holds: "texts",
  },
  "objects": {
    type: "Item[]",
    declarations:
      "class Item {\n  constructor(\n    public worth: number,\n    public next: Item | null = null,\n  ) {}\n}",
    make: "[3, 1, 4, 1, 5, 9, 2, 6].map(worth => new Item(worth, new Item(worth + 1)))",
    other: "[new Item(70), new Item(71), new Item(72)]",
    value: "e === undefined ? -1000 : e.worth + (e.next === null ? 0 : e.next.worth)",
    fresh: "new Item(n)",
    holds: "objects",
  },
  "a-list-with-gaps": {
    type: "number[]",
    make: "[3, , 4, 1, , 9, 2, 6] as number[]",
    other: "[70, , 72] as number[]",
    value: "e === undefined ? -1000 : e",
    fresh: "n",
    holds: "numbers",
  },
  "a-counted-list": {
    type: "number[]",
    declarations:
      "function counted(n: number): number[] {\n  const list: number[] = [];\n  for (let i = 0; i < n; i++) list.push(i * 5 + 2);\n  return list;\n}",
    make: "counted(8)",
    other: "counted(3)",
    value: "e === undefined ? -1000 : e",
    fresh: "n",
    holds: "numbers",
  },
  "a-list-of-a-class-below-array": {
    type: "Row",
    declarations: "class Row extends Array<number> {}",
    make: "Row.from([3, 1, 4, 1, 5, 9, 2, 6]) as Row",
    other: "Row.from([70, 71, 72]) as Row",
    value: "e === undefined ? -1000 : e",
    fresh: "n",
    holds: "numbers",
  },
  "a-float64-array": bytes("Float64Array", 8, buffer => `new Float64Array(${buffer}, 0, 8)`, false),
  "a-float32-array": bytes("Float32Array", 4, buffer => `new Float32Array(${buffer}, 0, 8)`, false),
  "an-int32-array": bytes("Int32Array", 4, buffer => `new Int32Array(${buffer}, 0, 8)`, false),
  "a-uint8-array": bytes("Uint8Array", 1, buffer => `new Uint8Array(${buffer}, 0, 8)`, false),
  "a-uint8-array-behind-an-offset": bytes("Uint8Array", 1, buffer => `new Uint8Array(${buffer}, 4, 8)`, false),
  "a-bigint64-array": bytes("BigInt64Array", 8, buffer => `new BigInt64Array(${buffer}, 0, 8)`, false),
  "a-float64-array-that-tracks-its-buffer": bytes("Float64Array", 8, buffer => `new Float64Array(${buffer})`, true),
  "an-int16-array-that-tracks-its-buffer-from-an-offset": bytes(
    "Int16Array",
    2,
    buffer => `new Int16Array(${buffer}, 8)`,
    true,
  ),
  "a-uint8-array-over-a-part-of-a-resizable-buffer": bytes(
    "Uint8Array",
    1,
    buffer => `new Uint8Array(${buffer}, 2, 8)`,
    true,
  ),
  "a-uint32-array-that-tracks-its-buffer": bytes("Uint32Array", 4, buffer => `new Uint32Array(${buffer})`, true),
};

type Change = {
  /** Statements about `list`. `FRESH(n)` stands for a new element. */
  text: string;
  /** Statements that take back what outlives the list. */
  undo?: string;
  only?: (kind: Kind) => boolean;
};
const ofLists = (kind: Kind) => !kind.isTypedArray;
const ofNumbers = (kind: Kind) => !kind.isTypedArray && kind.holds === "numbers";
const ofItsOwnClass = (kind: Kind) => kind.type === "Row";
const ofTypedArrays = (kind: Kind) => !!kind.isTypedArray;
const ofResizable = (kind: Kind) => !!kind.isResizable;
const buffer = "(list.buffer as ArrayBuffer)";

const changes: Record<string, Change> = {
  // Lists.
  "pushed-to": { text: "list.push(FRESH(50));", only: ofLists },
  "pushed-to-until-the-storage-moves": {
    text: "for (let k = 0; k < 40; k++) list.push(FRESH(50 + k));",
    only: ofLists,
  },
  "popped": { text: "list.pop();", only: ofLists },
  "popped-empty": { text: "while (list.length) list.pop();", only: ofLists },
  "cut-to-nothing": { text: "list.length = 0;", only: ofLists },
  "cut-to-two": { text: "list.length = 2;", only: ofLists },
  "cut-to-nothing-and-filled-again": {
    text: "list.length = 0;\n  for (let k = 0; k < 8; k++) list.push(FRESH(80 + k));",
    only: ofLists,
  },
  "lengthened": { text: "list.length = 20;", only: ofLists },
  "shifted": { text: "list.shift();", only: ofLists },
  "shifted-three-times": { text: "list.shift();\n  list.shift();\n  list.shift();", only: ofLists },
  "unshifted": { text: "list.unshift(FRESH(60), FRESH(61));", only: ofLists },
  "spliced-shorter": { text: "list.splice(2, 4);", only: ofLists },
  "spliced-longer": { text: "list.splice(2, 0, FRESH(62), FRESH(63), FRESH(64));", only: ofLists },
  "stored-to-far-behind-the-end": { text: "list[list.length + 40] = FRESH(65);", only: ofLists },
  "stored-to-five-million-behind-the-end": { text: "list[5_000_000] = FRESH(66);", only: ofLists },
  "with-elements-deleted": { text: "delete list[5];\n  delete list[1];", only: ofLists },
  "given-a-fraction": { text: "list[5] = 0.5;\n  list[1] = -0.25;", only: ofNumbers },
  "given-a-number-past-the-integers": { text: "list[5] = 2 ** 40;\n  list[1] = -0;", only: ofNumbers },
  "given-a-text-through-any": { text: '(list as any[])[5] = "five";\n  (list as any[])[1] = null;', only: ofNumbers },
  "reversed": { text: "list.reverse();" },
  "filled": { text: "list.fill(FRESH(67), 1, 6);" },
  "copied-within": { text: "list.copyWithin(0, 3);" },
  "given-a-getter-for-an-element": {
    text: "Object.defineProperty(list, 5, { get: () => FRESH(68), set() {}, configurable: true, enumerable: true });",
    only: ofLists,
  },
  "frozen": { text: "Object.freeze(list);", only: ofLists },
  "sealed-and-cut": { text: "Object.seal(list);\n  try {\n    list.length = 3;\n  } catch {}", only: ofLists },
  "with-a-length-made-read-only": {
    text: 'Object.defineProperty(list, "length", { writable: false });',
    only: ofLists,
  },
  "given-a-prototype-with-elements": {
    text: "delete list[5];\n  Object.setPrototypeOf(list, Object.create(Array.prototype, { 5: { value: FRESH(69), writable: true, configurable: true } }));",
    only: ofLists,
  },
  "given-a-prototype-with-a-setter-for-an-element": {
    text: "list.length = 5;\n  Object.setPrototypeOf(\n    list,\n    Object.create(Array.prototype, {\n      5: {\n        get: () => FRESH(70),\n        set(e: unknown) {\n          caught += 1;\n        },\n      },\n    }),\n  );",
    only: ofLists,
  },
  "with-a-gap-over-an-element-of-the-prototype-of-its-class": {
    text: "delete list[5];\n  (Row.prototype as any)[5] = FRESH(71);",
    undo: "delete (Row.prototype as any)[5];",
    only: ofItsOwnClass,
  },
  "cut-in-front-of-a-setter-of-the-prototype-of-its-class": {
    text: 'list.length = 5;\n  Object.defineProperty(Row.prototype, "5", {\n    get: () => FRESH(72),\n    set(e: unknown) {\n      caught += 1;\n    },\n    configurable: true,\n  });',
    undo: "delete (Row.prototype as any)[5];",
    only: ofItsOwnClass,
  },
  // Typed arrays.
  "transferred": { text: `${buffer}.transfer();`, only: ofTypedArrays },
  "transferred-to-fewer-bytes": { text: `${buffer}.transfer(8);`, only: ofTypedArrays },
  "transferred-to-a-fixed-length": { text: `${buffer}.transferToFixedLength();`, only: ofTypedArrays },
  "transferred-by-a-structured-clone": {
    text: `structuredClone(list.buffer, { transfer: [${buffer}] });`,
    only: ofTypedArrays,
  },
  "resized-to-nothing": { text: `${buffer}.resize(0);`, only: ofResizable },
  "resized-to-a-third": { text: `${buffer}.resize(${buffer}.byteLength / 3);`, only: ofResizable },
  "resized-to-twice": { text: `${buffer}.resize(${buffer}.byteLength * 2);`, only: ofResizable },
  "resized-to-nothing-and-back": {
    text: `const before = ${buffer}.byteLength;\n  ${buffer}.resize(0);\n  ${buffer}.resize(before);`,
    only: ofResizable,
  },
  "given-a-length-of-its-own": {
    text: 'Object.defineProperty(list, "length", { value: 3, configurable: true });',
    only: ofTypedArrays,
  },
  "given-a-prototype-with-another-length": {
    text: "Object.setPrototypeOf(list, Object.create(Object.getPrototypeOf(list), { length: { get: () => 3 } }));",
    only: ofTypedArrays,
  },
  "set-from-a-list": { text: "list.set(list.slice(0, 3), 4);", only: ofTypedArrays },
  "sorted-downward": { text: "list.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));" },
  // Whoever holds the list gets another one. `REPLACE` stands for the store, which a parameter has too.
  "replaced-by-a-shorter-one": { text: "REPLACE" },
};

/** Where the change is made. `CHANGE` stands for a call of change(); `LIST` for what the loop reads the list from; `LOOK` for the read or the store of the turn. */
type Place = {
  /** Beside the function, ahead of it. */
  outside?: string;
  /** Ahead of the loop. */
  ahead?: string;
  /** The body of a turn. */
  turn: string;
  /** The function is a generator or async, or takes a callback: how it is declared and called. */
  parameters?: string;
  arguments?: string;
};
const places: Record<string, Place> = {
  "in-the-turn": { turn: "if (i === at) CHANGE;\n    LOOK" },
  "by-a-callback": {
    parameters: ", step: (i: number) => void",
    arguments: ", i => {\n        if (i === at) change(list);\n      }",
    turn: "step(i);\n    LOOK",
  },
  "by-a-getter": {
    ahead:
      "const bonus = {\n    turn: 0,\n    get now(): number {\n      if (this.turn++ === at) CHANGE;\n      return 1;\n    },\n  };",
    turn: "sum += bonus.now;\n    LOOK",
  },
  "by-converting-an-operand": {
    ahead:
      "let converted = 0;\n  const operand = {\n    valueOf(): number {\n      if (converted++ === at) CHANGE;\n      return 1;\n    },\n  };",
    turn: "sum += +operand;\n    LOOK",
  },
  "by-converting-the-index": {
    ahead:
      "let converted = 0;\n  const none = {\n    valueOf(): number {\n      if (converted++ === at) CHANGE;\n      return 0;\n    },\n  };",
    turn: "LOOK_AT(i + +none)",
  },
  "between-two-reads": {
    turn: "sum = mix(sum, value(LIST[i]) + (i === at ? (CHANGE, 1) : 0) + value(LIST[i]));\n    LOOK",
  },
  "in-an-argument": {
    outside: "function three(a: number, b: number, c: number): number {\n  return a * 3 + b * 5 + c * 7;\n}",
    turn: "sum = mix(sum, three(value(LIST[i]), i === at ? (CHANGE, 1) : 0, value(LIST[i])));\n    LOOK",
  },
  "by-the-function-itself": {
    parameters: ", depth = 0",
    turn: "if (i === at && depth === 0) {\n      CHANGE;\n      sum = mix(sum, SELF(AGAIN, 1));\n    }\n    LOOK",
  },
  "ahead-of-a-caught-throw": {
    turn: 'try {\n      if (i === at) {\n        CHANGE;\n        throw new RangeError("left");\n      }\n      sum += 1;\n    } catch {\n      sum += 2;\n    }\n    LOOK',
  },
  "in-a-finally": {
    turn: "try {\n      if (i === at) continue;\n      sum += 1;\n    } finally {\n      if (i === at) CHANGE;\n      LOOK\n    }",
  },
  "on-a-long-rare-path": {
    turn: `if (i === at) {\n      let t = sum | 0;\n${Array.from({ length: 24 }, (_, k) => `      t = ((t ^ ${k + 5}) * 3 + value(LIST[${k % 8}])) | 0;`).join("\n")}\n      CHANGE;\n      sum = mix(sum, t + value(LIST[i]));\n    }\n    LOOK`,
  },
  "in-an-inner-loop": {
    turn: "for (let k = 0; k < 3; k++) {\n      if (i === at && k === 1) CHANGE;\n      sum = mix(sum, value(LIST[k]));\n    }\n    LOOK",
  },
};

/** How the loop counts. `TURN` stands for the body of a turn. */
const loops: Record<string, string> = {
  "up-to-its-length": "for (let i = 0; i < LIST.length; i++) {\n    TURN\n  }",
  "up-to-the-length-it-had": "const n = LIST.length;\n  for (let i = 0; i < n; i++) {\n    TURN\n  }",
  "down-from-its-end": "for (let i = LIST.length - 1; i >= 0; i--) {\n    TURN\n  }",
  "while-the-index-is-in-it": "let i = -1;\n  while (++i < LIST.length) {\n    TURN\n  }",
  "for-a-given-number-of-turns": "for (let i = 0; i < turns; i++) {\n    TURN\n  }",
  "at-least-once": "let i = -1;\n  do {\n    i++;\n    TURN\n  } while (i + 1 < LIST.length);",
};

/** What the loop reads the list from. */
type Holder = { outside?: string; ahead?: string; list: string; replace: string };
const holders: Record<string, Holder> = {
  "a-parameter": { list: "list", replace: "list = OTHER" },
  "a-variable-of-the-module": {
    outside: "let held: List = MAKE;",
    ahead: "held = list;",
    list: "held",
    replace: "held = OTHER",
  },
  "a-field": {
    outside: "class Shelf {\n  constructor(public items: List) {}\n}",
    ahead: "const shelf = new Shelf(list);",
    list: "shelf.items",
    replace: "shelf.items = OTHER",
  },
  "a-variable-that-a-closure-stores-to": {
    ahead: "let kept = list;\n  const keep = (next: List) => {\n    kept = next;\n  };",
    list: "kept",
    replace: "keep(OTHER)",
  },
};

function program(
  kindName: string,
  changeName: string,
  placeName: string,
  loopName: string,
  holderName: string,
): string | undefined {
  const kind = kinds[kindName];
  const change = changes[changeName];
  const place = places[placeName];
  const holder = holders[holderName];
  const isReplaced = change.text === "REPLACE";
  // A callback made by the caller sees the caller's list and not what the function holds it in.
  if (isReplaced && place.arguments) return;
  const freshOf = (n: string) => kind.fresh.replace(/\bn\b(?!")/g, n);
  const call = isReplaced ? holder.replace.replace("OTHER", kind.other) : `change(${holder.list})`;
  const body = (name: string, look: (index: string) => string) => {
    const turn = place.turn
      .replaceAll("LOOK_AT(i + +none)", look("i + +none"))
      .replaceAll("LOOK", look("i"))
      .replaceAll("CHANGE", call)
      .replaceAll("SELF", name)
      .replaceAll("AGAIN", `${holder.list}, -1, turns`);
    const ahead = [holder.ahead, place.ahead?.replaceAll("CHANGE", call)].filter(Boolean).join("\n  ");
    return `function ${name}(list: List, at: number, turns: number${place.parameters ?? ""}): number {
  let sum = 0;
  ${ahead ? ahead + "\n  " : ""}${loops[loopName].replace("TURN", () => turn)}
  return mix(sum, ${holder.list}.length);
}`.replaceAll("LIST", holder.list);
  };
  const more = {
    numbers: "LIST[INDEX]! + 1",
    bigints: "LIST[INDEX]! + 1n",
    texts: 'LIST[INDEX] + "!"',
    objects: "new Item(value(LIST[INDEX]))",
  }[kind.holds];
  const sentence = `${kindName} held in ${holderName}, ${changeName} ${placeName}, in a loop ${loopName}`.replaceAll(
    "-",
    " ",
  );
  const walk = (name: string) => `    list = ${kind.make};
    try {
      sum = ${name}(list, at, 8${place.arguments ?? ""});
    } catch (error) {
      sum = (error as Error).name.length;
    }${change.undo ? "\n    " + change.undo : ""}
    total = mix(total, sum);
    if (round === 0 || round === 29) console.log("${name}", at, sum, show(list), caught);`;
  return `// ${sentence[0].toUpperCase()}${sentence.slice(1)}: every turn reads and stores what plain Bun reads and stores.
type List = ${kind.type};
${kind.declarations ? kind.declarations + "\n" : ""}let caught = 0;
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function value(e: List[number] | undefined): number {
  return ${kind.value};
}
${isReplaced ? "" : `function change(list: List): void {\n  ${change.text.replace(/FRESH\(([^()]*)\)/g, (_, n) => `(${freshOf(n)})`)}\n}\n`}${[holder.outside?.replace("MAKE", kind.make), place.outside].filter(Boolean).join("\n")}
${body("reads", index => `sum = mix(sum, value(LIST[${index}]));`)}
${body("stores", index => `LIST[${index}] = ${freshOf("(i + 90)")};`)}
${body("adds", index => `LIST[${index}] = ${more.replaceAll("INDEX", index)};`)}
function show(list: List): string {
  let text = list.length + ":";
  for (let i = 0; i < list.length && i < 24; i++) text += (i in list ? value(list[i]) : "gap") + ",";
  return text;
}
let total = 0;
let sum = 0;
let list: List;
for (let round = 0; round < 30; round++) {
  for (const at of [-1, 0, 1, 4, 7, 8]) {
${["reads", "stores", "adds"].map(walk).join("\n")}
  }
}
console.log(total);
`;
}

/** What does not get through every build today, and how. Whoever mends it takes the line out. */
const stopsToday: Record<string, string> = {};

function files() {
  const written: Record<string, string> = { ...shapedForOneWayToMove };
  const kindNames = Object.keys(kinds);
  const holderNames = Object.keys(holders);
  let turn = 0;
  for (const changeName in changes)
    for (const placeName in places) {
      // Every change in every place, on two kinds of list; the kinds, the loops and the holders take turns.
      const fitting = kindNames.filter(name => changes[changeName].only?.(kinds[name]) ?? true);
      // A loop up to a length of five million takes too long.
      const loopNames = Object.keys(loops).filter(
        name => !changeName.includes("five-million") || name === "for-a-given-number-of-turns",
      );
      for (let pick = 0; pick < 2; pick++, turn++) {
        const kindName = fitting[(turn * 5 + pick * 3) % fitting.length];
        const text = program(
          kindName,
          changeName,
          placeName,
          loopNames[turn % loopNames.length],
          holderNames[(turn >> 1) % holderNames.length],
        );
        if (text) written[`${kindName}-${changeName}-${placeName}.ts`] = text;
      }
    }
  for (const name in stopsToday) written[`${name}.todo.txt`] = stopsToday[name] + "\n";
  return written;
}

export const programs = () => programsOf(files());
