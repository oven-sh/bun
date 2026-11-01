// `for (let i = 0; i < n; i++) t += L[i]`: one straight loop over one or two typed arrays, of the kinds that a compiler may write out by
// several turns or run by several elements at once: a sum, a largest or smallest element, a copy, a fill, a change of each element, a count,
// a search. Doing several turns at once is right only under conditions, and each function goes to their edges: a length just below, at
// and above a multiple of 2, 4, 8 and 16; a bound past the end of the array, read from the array or handed in; a start that is not 0; a
// step of 2, or a loop that runs down; a sum that starts at a fraction, at -0 or past 2 ** 53; elements that are NaN, -0 or the largest of
// their kind; unsigned kinds, where the top bit is no sign; and a second array that is a view of the first one's memory, shifted by a few
// elements or, among the integer kinds, of another width, so that a store of one turn is read by a later one. Every length, start and
// content is written at the call.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

const kinds = [
  "Int32Array",
  "Int32Array",
  "Float64Array",
  "Float64Array",
  "Uint8Array",
  "Uint32Array",
  "Float32Array",
  "Int16Array",
  "Uint16Array",
  "Int8Array",
  "Uint8ClampedArray",
];
const bytes: Record<string, number> = {
  Int32Array: 4,
  Float64Array: 8,
  Uint8Array: 1,
  Uint32Array: 4,
  Float32Array: 4,
  Int16Array: 2,
  Uint16Array: 2,
  Int8Array: 1,
  Uint8ClampedArray: 1,
};
const lengths = [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 47, 64, 65, 100];

export function helpers(typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  return `function show(v${as("unknown")})${as("string")} {
  return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v);
}
function filled${typed ? "<T>" : ""}(L${as("T")}, seed${as("number")}, odd${as("number[]")})${as("T")} {
  const all${as("any")} = L;
  let state = seed | 0;
  for (let i = 0; i < all.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    all[i] = state >>> 28 === 0 ? odd[(state >>> 8) % odd.length] : (state >> 16) % 100;
  }
  return L;
}
`;
}

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const kind = random.pick(kinds);
  const isFloat = kind.startsWith("Float");
  const form = random.weighted([
    [4, "sum"],
    [3, "extreme"],
    [3, "copy"],
    [2, "fill"],
    [3, "change"],
    [2, "count"],
    [1, "find"],
    [4, "again"],
  ] as const);
  const usesTwo = form === "copy" || form === "again" || (form !== "fill" && random.chance(0.3));
  const otherKind = usesTwo && random.chance(0.25) ? random.pick(kinds) : kind;

  const step = random.weighted([
    [7, 1],
    [2, 2],
    [1, 3],
  ] as const);
  const goesDown = random.chance(0.15);
  const start = random.weighted([
    [6, 0],
    [2, 1],
    [1, 3],
  ] as const);
  const bound = random.weighted([
    [4, "n"],
    [3, "L.length"],
    [1, "L.length - 1"],
    [1, String(random.pick(lengths))],
  ] as const);
  const at = random.weighted([
    [8, "i"],
    [1, "i + 1"],
    [1, "2 * i"],
    [1, "i * 2 + 1"],
  ] as const);
  const shift = random.pick(["i", "i", "i", "i + 1", "i - 1", "i + 4", "i + 2"]);
  const element = `L[${at}]`;
  const second = `M[${random.chance(0.7) ? at : shift}]`;
  const read =
    usesTwo && form !== "copy" && form !== "again"
      ? random.pick([`${element} + ${second}`, `${element} * ${second}`, `${element} - ${second}`])
      : element;

  let body: string;
  switch (form) {
    case "sum":
      body = random.pick([
        `t += ${read};`,
        `t += ${read};`,
        `t += ${read} * 2;`,
        `t = (t + ${read}) | 0;`,
        `t ^= ${read};`,
        `t |= ${read};`,
        `t += ${read}; u += i;`,
        `t -= ${read};`,
      ]);
      break;
    case "extreme":
      body = random.pick([
        `if (${read} > t) t = ${read};`,
        `if (${read} < t) t = ${read};`,
        `t = Math.max(t, ${read});`,
        `t = Math.min(t, ${read});`,
        `t = ${read} > t ? ${read} : t;`,
        `if (${read} >= t) { t = ${read}; u = i; }`,
      ]);
      break;
    case "copy":
      body = random.pick([
        `M[${shift}] = ${element};`,
        `M[${shift}] = ${element};`,
        `M[${at}] = ${element} + 1;`,
        `M[${shift}] = ${element}; t += M[i];`,
      ]);
      break;
    case "fill":
      body = random.pick([
        `${element} = v;`,
        `${element} = i;`,
        `${element} = i * 2 + 1;`,
        `${element} = v + i;`,
        `${element} = -i;`,
        `${element} = i * v;`,
      ]);
      break;
    case "change":
      body = random.pick([
        `${element} = ${read} * 2;`,
        `${element} = ${read} + 1;`,
        `${element} = -${element};`,
        `${element} += v;`,
        `${element} = ${read} & 255;`,
        `${element} >>= 1;`,
        `${element} = ${read} >>> 1;`,
        `${element} = ${read} / 2;`,
        `${element} = L[${shift}] + 1;`,
        `${element} = Math.abs(${read});`,
      ]);
      break;
    // An element is read, something is stored through the other array, which may be the same memory, and the element or its neighbor is read.
    case "again":
      body = random.pick([
        `const p = ${element}; M[${shift}] = ${random.pick(["v", "p + 1", "i"])}; t += p + ${element};`,
        `const p = L[i]; M[${random.pick(["i + 1", "i", "i + 2"])}] = ${random.pick(["v", "p + 1"])}; t += p + L[i + 1];`,
        `const p = ${element}; if (p === v) M[${shift}] = p + 1; t += p + ${element};`,
        `t += L[i] + L[i + 1]; M[${shift}] = t & 255; t += L[i] + L[i + 1];`,
        `const p = ${element}; if (p > ${random.pick([90, 95, 1000])}) M[${shift}] = 0; t ^= ${element};`,
      ]);
      break;
    case "count":
      body = random.pick([
        `if (${read} === v) t++;`,
        `t += ${read} > v ? 1 : 0;`,
        `if (${read} < v) t++;`,
        `if (${read} !== ${read}) t++;`,
        `if (${read} & 1) t++;`,
      ]);
      break;
    default:
      body = random.pick([
        `if (${read} === v) return i;`,
        `if (${read} > v) { t = i; break; }`,
        `if (${read} < 0) return i + t;`,
      ]);
  }
  const stepped =
    step === 1
      ? random.pick(goesDown ? ["i--", "--i"] : ["i++", "++i", "i += 1"])
      : `i ${goesDown ? "-=" : "+="} ${step}`;
  const head = goesDown
    ? `for (let i = ${bound} - 1; i >= ${start}; ${stepped})`
    : `for (let i = ${start}; i < ${bound}; ${stepped})`;
  const text = `function ${name}(L${as(kind)}, M${as(otherKind)}, n${as("number")}, s${as("number")}, v${as("number")}) {
  let t = ${random.weighted([
    [5, "s"],
    [4, "0"],
    [1, "L[0]"],
  ] as const)}, u = 0;
  ${head} {
    ${body}
  }
  return show(t) + " " + u;
}
`;

  const odd = isFloat
    ? "[NaN, -0, 0.5, 1e21, -Infinity, 2147483648]"
    : "[2147483647, -2147483648, 255, 128, 65535, 32768, -1, 4294967295]";
  const starts =
    form === "extreme"
      ? ["0", "-Infinity", "Infinity", "-1", "NaN", "-0", "2147483647"]
      : ["0", "0", "0.5", "-0", "1", "9007199254740992", "2147483647", "-2147483648", "1e21"];
  const called = () => {
    const length = random.pick(lengths);
    const n = random.weighted([
      [5, length],
      [2, Math.max(0, length - 1)],
      [2, length + random.pick([1, 2, 5])],
      [1, Math.floor(length / 2)],
    ] as const);
    const first = `filled(new ${kind}(${length}), ${random.between(1, 999)}, ${odd})`;
    const offset = random.pick([0, 1, 1, 2, 4]);
    const view = !usesTwo
      ? "L"
      : random.weighted([
          [3, "L"],
          [3, `L.subarray(${offset})`],
          [
            2,
            otherKind === kind
              ? `new ${kind}(L.buffer, ${Math.min(offset, length) * bytes[kind]})`
              : `new ${otherKind}(L.buffer, 0, Math.floor(L.byteLength / ${bytes[otherKind]}))`,
          ],
          [3, `filled(new ${otherKind}(${random.pick(lengths)}), ${random.between(1, 999)}, [1, 2, 255])`],
        ] as const);
    // Which bits a NaN has in memory is left to the implementation, and a view of another kind over a float's memory would show them.
    const mayShare = otherKind === kind || (!isFloat && !otherKind.startsWith("Float"));
    const other =
      !view.includes("L.") && view !== "L"
        ? view
        : otherKind === kind
          ? view
          : mayShare
            ? `new ${otherKind}(L.buffer, 0, Math.floor(L.byteLength / ${bytes[otherKind]}))`
            : `filled(new ${otherKind}(${length}), ${length + 1}, [1, 2, 255])`;
    return `((L${as(kind)}) => { const M = ${other}; return ${name}(L, M, ${n}, ${random.pick(starts)}, ${random.pick(["0", "1", "7", "-1", "0.5", "255", "128", "NaN", "-0"])}) + "/" + String(L)${usesTwo ? ' + "/" + String(M)' : ""}; })(${first})`;
  };
  return { name, text, calls: Array.from({ length: random.between(4, 7) }, called) };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(6, 12) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
