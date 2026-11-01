// forEach, every, some, find, findIndex, findLast, findLastIndex, reduce and reduceRight of typed arrays. The length is read
// once, before the walk, and each element when its turn comes: a callback that stores into the view, shrinks, grows or hands
// off the buffer, or throws, shows how the walk is written. Each scene picks the class and how the view lies over its buffer,
// the method, what the callback does in one of its calls, and arguments that are wrong: no function, no first value for an
// empty view, a receiver of another kind. Every call of the callback is logged with its value and index.
import type { Random } from "./random";

const classes = [
  "Uint8Array",
  "Uint8Array",
  "Int8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "Float64Array",
  "Float16Array",
  "BigInt64Array",
  "BigUint64Array",
  "Buffer",
  "Below",
];

/** Statements that make `view` of class CLASS with elements made by `of(n)`. `buffer` is its buffer. */
const views = [
  "const view = CLASS.from([1, 2, 3, 4].map(of));",
  "const view = CLASS.from([1, 2, 3, 4].map(of));",
  "const view = new CLASS(4);\n    view.set([4, 3, 2, 1].map(of));",
  "const view = new CLASS(0);",
  "const view = new CLASS(1);",
  "const view = new CLASS(new ArrayBuffer(64), 16, 3);\n    view.set([5, 6, 7].map(of));",
  "const view = new CLASS(new ArrayBuffer(32, { maxByteLength: 128 }));\n    view.set([1, 2].map(of));",
  "const view = new CLASS(new ArrayBuffer(32, { maxByteLength: 128 }), 8);\n    view.set([1, 2].map(of));",
  "const view = new CLASS(new ArrayBuffer(32, { maxByteLength: 128 }), 0, 2);\n    view.set([1, 2].map(of));",
  "const view = CLASS.from([1, 2, 3, 4, 5, 6].map(of)).subarray(1, 4);",
  "const view = new CLASS(new SharedArrayBuffer(32));",
  "const view = CLASS.from({ length: 40 }, (_, at) => of(at % 7));",
];

/** Calls on `view`. STEP is the callback's body, which may use value, index and all. */
const calls = [
  "view.forEach((value, index, all) => {\n      STEP\n    })",
  "view.every((value, index, all) => {\n      STEP\n      return index < 2;\n    })",
  "view.every((value, index, all) => {\n      STEP\n      return 1;\n    })",
  "view.some((value, index, all) => {\n      STEP\n      return index === 2;\n    })",
  'view.some((value, index, all) => {\n      STEP\n      return "";\n    })',
  "view.find((value, index, all) => {\n      STEP\n      return index === 1;\n    })",
  "view.find((value, index, all) => {\n      STEP\n      return false;\n    })",
  "view.findIndex((value, index, all) => {\n      STEP\n      return value == 3;\n    })",
  "view.findLast((value, index, all) => {\n      STEP\n      return index === 1;\n    })",
  "view.findLastIndex((value, index, all) => {\n      STEP\n      return value == 2;\n    })",
  'view.reduce((sum, value, index, all) => {\n      STEP\n      return sum + String(value);\n    }, "")',
  "view.reduce((sum, value, index, all) => {\n      STEP\n      return sum + value;\n    })",
  'view.reduceRight((sum, value, index, all) => {\n      STEP\n      return sum + String(value);\n    }, "")',
  "view.reduceRight((sum, value, index, all) => {\n      STEP\n      return value;\n    })",
  'view.forEach(function (value, index) {\n      const all = view;\n      STEP\n      log.push(String(this?.tag));\n    }, { tag: "this" })',
  "view.forEach(logged)",
  "CLASS.prototype.some.call(view, (value, index, all) => {\n      STEP\n      return false;\n    })",
];

/** What the callback does besides logging, in the call with index 1. */
const steps = [
  "",
  "",
  "",
  "if (index === 1) all[2] = of(9);",
  "if (index === 1) all[0] = of(9);",
  "if (index === 1) all.fill(of(7));",
  "if (index === 1) all.buffer.resize?.(8);",
  "if (index === 1) all.buffer.resize?.(0);",
  "if (index === 1) all.buffer.resize?.(128);",
  "if (index === 1) all.buffer.transfer?.();",
  "if (index === 1) structuredClone(all.buffer, { transfer: [all.buffer] });",
  'if (index === 1) throw new RangeError("in the callback");',
  "if (index === 1) all.reverse();",
  'if (index === 1) all.forEach(() => log.push("inner"));',
  "if (index === 1) Bun.gc(true);",
  "if (index === 1) all.extra = 1;",
];

/** Calls that are wrong. */
const wrong = [
  "view.forEach()",
  "view.forEach(5)",
  "view.every(null)",
  "view.find({})",
  "view.reduce(undefined, 0)",
  "new CLASS(0).reduce((a, b) => a)",
  "new CLASS(0).reduceRight((a, b) => a)",
  "CLASS.prototype.forEach.call([1, 2], logged)",
  "CLASS.prototype.some.call({ length: 2 }, logged)",
  "CLASS.prototype.reduce.call(null, logged)",
  "CLASS.prototype.find.call(new DataView(new ArrayBuffer(8)), logged)",
  "Uint8Array.prototype.findLast.call(view, (value, index) => index === 0)",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const name = random.pick(classes);
    const isBig = name.startsWith("Big");
    const named = (text: string) => text.replaceAll("CLASS", name);
    scenes.push(`function scene${scene}() {
  const of = ${isBig ? "n => BigInt(n)" : random.pick(["n => n", "n => n", "n => n + 0.5", "n => -n", "n => n * 100"])};
  let last = "";
  for (let turn = 0; turn < ${random.pick([1, 1, 3, 100])}; turn++) {
    log.length = 0;
    let answer;
    try {
    ${named(random.pick(views))}
      answer = shown(${named(random.pick(calls)).replace("STEP", `log.push(String(value) + "@" + index);\n      ${random.pick(steps)}`)}) + " " + view.length + " " + shown(view[0]) + " " + shown(view[2]);
    } catch (error) {
      answer = "threw " + error.name;
    }
    last = noted(answer + " | " + log.slice(0, 12).join() + " " + log.length);
  }
  return last + " " + counted();
}
console.log("scene ${scene} ${name}", scene${scene}());
console.log("scene ${scene} wrong", told(() => {
  const view = new ${name}(2);
  return ${named(random.pick(wrong))};
}));`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set();
function noted(answer) {
  rounds.add(answer);
  return answer;
}
function counted() {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const log = [];
class Below extends Int16Array {}
function logged(value, index) {
  log.push(String(value) + "@" + index);
}
function shown(value) {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value);
}
function told(ask) {
  try {
    return shown(ask());
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
