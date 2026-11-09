// The programs of callees-replaced-behind-their-test. `bun test/aot/generate.ts callees-replaced-behind-their-test <where>` writes them.
// A call in a loop that runs often is made directly, or its callee is copied into the loop, behind a test of which function is called; what the callee has captured is read from the
// function object. Each program here puts another function in the place of the callee between such a test and the call, or enters the loop with the other one: every call runs the function
// that plain Bun calls, with what that function has captured.
// A loop of the library may run ahead of the variable that holds the callee, and by the names of its members an iterator of the program that calls the variable could be what it walks.
// One pair of functions, one holder and one place for the store a program.
import { programsOf } from "../generate";
import { callees as shapedForOneWayToMove } from "./what-is-moved-ahead-of-a-loop";

/** `usual` and `other` are expressions of type Step. `UPSET` stands where the usual callee itself may replace its holder. */
type Pair = { declarations: string; usual: string; other: string; mayBeNothing?: boolean };
const pairs: Record<string, Pair> = {
  "two-closures-of-one-function": {
    declarations: "function adder(n: number): Step {\n  return x => {\n    UPSET\n    return x + n;\n  };\n}",
    usual: "adder(3)",
    other: "adder(1000)",
  },
  "a-closure-over-a-list-and-one-over-a-number": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + list.length;\n  };\n}\nfunction adder(n: number): Step {\n  return x => x + n;\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "adder(1000)",
  },
  "a-closure-over-a-text-and-one-over-a-list": {
    declarations:
      "function coder(text: string): Step {\n  return x => {\n    UPSET\n    return text.charCodeAt(x & 3) + text.length;\n  };\n}\nfunction picker(list: number[]): Step {\n  return x => list[x & 3]! * 2;\n}",
    usual: 'coder("step" + process.argv.length)',
    other: "picker([50, 60, 70, 80])",
  },
  "a-closure-over-a-typed-array-and-one-over-an-object": {
    declarations:
      "function sampler(samples: Float64Array): Step {\n  return x => {\n    UPSET\n    return samples[x & 3]! + samples.length;\n  };\n}\nfunction reader(point: { x: number; y: number }): Step {\n  return x => point.x * x + point.y;\n}",
    usual: "sampler(new Float64Array([1.5, 2.5, 3.5, 4.5]))",
    other: "reader({ x: 3, y: 4 })",
  },
  "a-closure-and-a-function-that-captures-nothing": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}\nfunction doubled(x: number): number {\n  return x * 2;\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "doubled",
  },
  "a-closure-and-a-built-in-function": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "Math.sqrt",
  },
  "a-closure-and-a-bound-function": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}\nfunction scaled(this: { by: number }, more: number, x: number): number {\n  return this.by * x + more;\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "scaled.bind({ by: 3 }, 7)",
  },
  "a-closure-with-six-captures-and-one-with-one": {
    declarations:
      "function wide(a: number, b: number[], c: string, d: number, e: { v: number }, f: number[]): Step {\n  return x => {\n    UPSET\n    return a + b[x & 1]! + c.length + d + e.v + f[x & 1]!;\n  };\n}\nfunction adder(n: number): Step {\n  return x => x + n;\n}",
    usual: 'wide(1, [2, 3], "four", 5, { v: 6 }, [7, 8])',
    other: "adder(1000)",
  },
  "a-closure-and-a-proxy-of-a-function": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "new Proxy(picker([1, 2, 3, 4]), { apply: (target, _, [x]) => target(x) * 100 })",
  },
  "two-closures-over-variables-that-change": {
    declarations:
      "function counter(from: number): Step {\n  let n = from;\n  return x => {\n    UPSET\n    n += 1;\n    return x + n;\n  };\n}",
    usual: "counter(0)",
    other: "counter(1000)",
  },
  "two-arrows-that-captured-this": {
    declarations:
      "class Scale {\n  constructor(public by: number[]) {}\n  step(): Step {\n    return x => {\n      UPSET\n      return this.by[x & 1]! * x;\n    };\n  }\n}",
    usual: "new Scale([2, 3]).step()",
    other: "new Scale([200, 300]).step()",
  },
  "a-closure-and-nothing": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "undefined",
    mayBeNothing: true,
  },
  "a-closure-and-a-class": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}\nclass Made {\n  constructor(public x: number) {}\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "Made as unknown as Step",
  },
  "a-closure-and-an-async-function": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}\nasync function later(x: number): Promise<number> {\n  return x;\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "later as unknown as Step",
  },
  "a-closure-and-a-generator-function": {
    declarations:
      "function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}\nfunction* steps(x: number): Generator<number> {\n  yield x;\n}",
    usual: "picker([5, 6, 7, 8])",
    other: "steps as unknown as Step",
  },
  "a-closure-and-a-method-that-reads-this": {
    declarations:
      'function picker(list: number[]): Step {\n  return x => {\n    UPSET\n    return list[x & 3]! + 1;\n  };\n}\nfunction asked(this: unknown, x: number): number {\n  return (this === undefined ? 1 : typeof this === "object" ? 2 : 3) * 100 + x;\n}',
    usual: "picker([5, 6, 7, 8])",
    other: "asked",
  },
};

/** What holds the callee. `callee` is what stands in front of the arguments; `store` stores `NEXT`. `isReachedFromOutside`: the caller of run() can store too, by `storeOutside`. */
type Holder = { outside?: string; ahead: string; callee: string; store: string; storeOutside?: string };
const holders: Record<string, Holder> = {
  "a-local-variable": { ahead: "let step = first;", callee: "step", store: "step = NEXT" },
  "a-variable-of-the-module": {
    outside: "let held: Callee;",
    ahead: "held = first;",
    callee: "held",
    store: "held = NEXT",
    storeOutside: "held = NEXT",
  },
  "a-field": {
    outside:
      "class Box {\n  constructor(public step: Callee) {}\n}\nconst box = new Box(undefined as unknown as Callee);",
    ahead: "box.step = first;",
    callee: "box.step",
    store: "box.step = NEXT",
    storeOutside: "box.step = NEXT",
  },
  "an-element-of-a-list": {
    outside: "const table: Callee[] = [];",
    ahead: "table[0] = first;",
    callee: "table[0]!",
    store: "table[0] = NEXT",
    storeOutside: "table[0] = NEXT",
  },
  "a-variable-that-a-closure-stores-to": {
    ahead: "let kept = first;\n  const keep = (next: Callee) => {\n    kept = next;\n  };",
    callee: "kept",
    store: "keep(NEXT)",
  },
  "a-map": {
    outside: "const handlers = new Map<string, Callee>();",
    ahead: 'handlers.set("step", first);',
    callee: 'handlers.get("step")!',
    store: 'handlers.set("step", NEXT)',
    storeOutside: 'handlers.set("step", NEXT)',
  },
  "a-static-field": {
    outside: "class Registry {\n  static step: Callee;\n}",
    ahead: "Registry.step = first;",
    callee: "Registry.step",
    store: "Registry.step = NEXT",
    storeOutside: "Registry.step = NEXT",
  },
};

/** Where the store is made. `STORE` stands for it, `CALL(..)` for a call with that argument. */
type Place = {
  outside?: string;
  ahead?: string;
  turn: string;
  parameters?: string;
  arguments?: string;
  insideCallee?: boolean;
};
const places: Record<string, Place> = {
  "in-the-turn": { turn: "if (i === at) STORE;\n    sum = mix(sum, CALL(i));" },
  "in-the-argument": { turn: "sum = mix(sum, CALL(i === at ? (STORE, i) : i));" },
  "by-a-getter-read-in-the-argument": {
    ahead:
      "const probe = {\n    turn: 0,\n    get now(): number {\n      if (this.turn++ === at) STORE;\n      return 1;\n    },\n  };",
    turn: "sum = mix(sum, CALL(i + probe.now));",
  },
  "by-converting-the-argument-inside-the-callee": {
    ahead:
      "let converted = 0;\n  const operand = {\n    valueOf(): number {\n      if (converted++ === at) STORE;\n      return converted;\n    },\n  } as unknown as number;",
    turn: "sum = mix(sum, CALL(operand));",
  },
  "by-the-callee-itself": {
    ahead: "trigger = at;\n  upset = () => {\n    STORE;\n  };",
    turn: "sum = mix(sum, CALL(i));",
    insideCallee: true,
  },
  "between-two-calls-of-one-expression": {
    turn: "sum = mix(sum, CALL(i) + (i === at ? (STORE, 1) : 0) + CALL(i + 1));",
  },
  "ahead-of-a-caught-throw": {
    turn: 'try {\n      if (i === at) {\n        STORE;\n        throw new RangeError("left");\n      }\n      sum += 1;\n    } catch {\n      sum += 2;\n    }\n    sum = mix(sum, CALL(i));',
  },
  "on-a-long-rare-path": {
    turn: `if (i === at) {\n      let t = sum | 0;\n${Array.from({ length: 24 }, (_, k) => `      t = ((t ^ ${k + 5}) * 3 + ${k % 6 === 0 ? "CALL(t & 7)" : "i"}) | 0;`).join("\n")}\n      STORE;\n      sum = mix(sum, t + CALL(i));\n    }\n    sum = mix(sum, CALL(i));`,
  },
  "by-the-function-itself": {
    parameters: ", depth = 0",
    turn: "if (i === at && depth === 0) {\n      STORE;\n      sum = mix(sum, run(second, first, 2, turns, 1));\n    }\n    sum = mix(sum, CALL(i));",
  },
  "in-an-inner-loop": {
    turn: "for (let k = 0; k < 3; k++) {\n      if (i === at && k === 1) STORE;\n      sum = mix(sum, CALL(k));\n    }",
  },
  "and-back-two-turns-later": {
    turn: "if (i === at) STORE;\n    if (i === at + 2) BACK;\n    sum = mix(sum, CALL(i));",
  },
  "by-a-callback": {
    parameters: ", notify: (i: number) => void = () => {}",
    arguments: ", i => {\n          if (i === at) STORE_OUTSIDE;\n        }",
    turn: "notify(i);\n    sum = mix(sum, CALL(i));",
  },
};

function program(pairName: string, holderName: string, placeName: string): string | undefined {
  const pair = pairs[pairName];
  const holder = holders[holderName];
  const place = places[placeName];
  if (place.arguments && !holder.storeOutside) return;
  const callee = pair.mayBeNothing ? holder.callee.replace(/!$/, "") : holder.callee;
  const call = (argument: string) =>
    pair.mayBeNothing ? `(${callee}?.(${argument}) ?? -1)` : `${callee}(${argument})`;
  // The arguments of CALL hold parentheses of their own.
  const withCalls = (text: string) => {
    for (let at = text.indexOf("CALL("); at >= 0; at = text.indexOf("CALL(")) {
      let depth = 0;
      let end = at + 4;
      do depth += text[end] === "(" ? 1 : text[end] === ")" ? -1 : 0;
      while ((end++, depth > 0));
      text = text.slice(0, at) + call(text.slice(at + 5, end - 1)) + text.slice(end);
    }
    return text;
  };
  const spelled = (text: string) =>
    withCalls(
      text
        .replaceAll("STORE_OUTSIDE", (holder.storeOutside ?? "").replace("NEXT", "b"))
        .replaceAll("STORE", holder.store.replace("NEXT", "second"))
        .replaceAll("BACK", holder.store.replace("NEXT", "first")),
    );
  const sentence = `${pairName} in ${holderName}: the second is stored ${placeName}`.replaceAll("-", " ");
  return `// ${sentence[0].toUpperCase()}${sentence.slice(1)}. Every call runs the function that plain Bun calls, with what that function has captured.
type Step = (x: number) => number;
type Callee = Step${pair.mayBeNothing ? " | undefined" : ""};
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
let trigger = -1;
let upset = (): void => {};
${pair.declarations.replaceAll("UPSET", place.insideCallee ? "if (x === trigger) upset();" : "").replace(/\n\s*\n/g, "\n")}
${[holder.outside, place.outside].filter(Boolean).join("\n")}
function run(first: Callee, second: Callee, at: number, turns: number${place.parameters ?? ""}): number {
  let sum = 0;
  ${[holder.ahead, place.ahead && spelled(place.ahead)].filter(Boolean).join("\n  ")}
  for (let i = 0; i < turns; i++) {
    ${spelled(place.turn)}
  }
  return sum;
}
let total = 0;
for (let round = 0; round < 30; round++) {
  const usual: Callee = ${pair.usual};
  const other: Callee = ${pair.other};
  for (const [a, b] of [
    [usual, other],
    [other, usual],
    [usual, usual],
    [other, other],
  ]) {
    for (const at of [-1, 0, 1, 4, 7]) {
      for (const turns of [8, 0]) {
        let sum: number;
        try {
          sum = run(a, b, at, turns${place.parameters?.startsWith(", depth") ? "" : spelled(place.arguments ?? "")});
        } catch (error) {
          sum = (error as Error).name.length;
        }
        total = mix(total, sum);
        if (round === 0 || round === 29) console.log(a === usual, b === usual, at, turns, sum);
      }
    }
  }
}
console.log(total);
`;
}

const helpers = ["some(Boolean)", "every(Boolean)", "find(Boolean)"];
/** Where the variable gets the other function. `STORE` stands for the store. */
const stores: Record<string, { inNext: string; inLoop: string; declaration: string }> = {
  "never-replaced": { inNext: "", inLoop: "", declaration: "const" },
  "replaced-in-next": { inNext: "if (j === 1) STORE;", inLoop: "", declaration: "let" },
  "replaced-in-the-loop": { inNext: "", inLoop: "if (each === 1) STORE;", declaration: "let" },
};

function programOfIterators(pairName: string, storeName: string, helper: string): string {
  const pair = pairs[pairName];
  const store = stores[storeName];
  const call = (argument: string) => (pair.mayBeNothing ? `(held?.(${argument}) ?? -1)` : `held(${argument})`);
  const sentence =
    `${helper.replace(/\(.*/, "")} of the iterators walks a list ahead of the variable that holds the first of ${pairName}`.replaceAll(
      "-",
      " ",
    );
  return `// ${sentence[0].toUpperCase()}${sentence.slice(1)}. An iterator of the program, made below the declaration, has the same members, and its next() calls what the variable holds, which is ${storeName.replaceAll("-", " ")}.
type Step = (x: number) => number;
type Callee = Step${pair.mayBeNothing ? " | undefined" : ""};
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
console.log([1, 2].values().${helper});
${pair.declarations.replaceAll("UPSET", "").replace(/\n\s*\n/g, "\n")}
${store.declaration} held: Callee = ${pair.usual};
const other: Callee = ${pair.other};
let total = 0;
function made(): any {
  let j = 0;
  return {
    [Symbol.iterator](): any {
      return this;
    },
    next(): any {
      total = mix(total, ${call("j")});
      ${store.inNext.replace("STORE", "held = other")}
      return { done: j >= 4, value: j++ };
    },
    return(): any {
      return {};
    },
  };
}
for (const each of made()) {
  total = mix(total, each + ${call("each")});
  ${store.inLoop.replace("STORE", "held = other")}
}
console.log(total, other === held);
`.replace(/\n\s*\n/g, "\n");
}

function files() {
  const written: Record<string, string> = { ...shapedForOneWayToMove };
  const pairNames = Object.keys(pairs);
  const holderNames = Object.keys(holders);
  const write = (pairName: string, holderName: string, placeName: string) => {
    const text = program(pairName, holderName, placeName);
    if (text) written[`${pairName}-in-${holderName}-${placeName}.ts`] = text;
  };
  let turn = 0;
  // Every pair in every place, and every holder in every place; what is left takes turns.
  for (const placeName in places) {
    for (const pairName of pairNames) write(pairName, holderNames[turn++ % holderNames.length], placeName);
    for (const holderName of holderNames) write(pairNames[turn++ % pairNames.length], holderName, placeName);
  }
  // Every pair below a walk of the library that runs ahead of the variable. What throws when it is called is left out.
  for (const pairName of pairNames)
    for (const storeName in stores)
      if (pairName !== "a-closure-and-a-class") {
        const helper = helpers[turn++ % helpers.length];
        written[`${pairName}-below-a-walk-by-${helper.replace(/\(.*/, "")}-${storeName}-called-by-an-iterator.ts`] =
          programOfIterators(pairName, storeName, helper);
      }
  return written;
}

export const programs = () => programsOf(files());
