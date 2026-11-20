// Every shape is a whole small program: it makes a list or a view, reads an element, writes in between, reads the element again and
// prints what it summed and what the list holds. The two positions may meet, so the second read has to see the store.
export type Shape = { name: string; typed: boolean; text: string };

const listsOfWholeNumbers = {
  push: "const a: number[] = []; for (let q = 0; q < 8; q++) a.push(q);",
  literal: "const a: number[] = [0, 1, 2, 3, 4, 5, 6, 7];",
  counted: "const a: number[] = new Array(8); for (let q = 0; q < 8; q++) a[q] = q;",
  map: "const a: number[] = [0, 1, 2, 3, 4, 5, 6, 7].map(v => v);",
};

function twoPositionsInOneLoop(): Shape[] {
  const positions = {
    halves: ["k & 7", "(k >> 1) & 7"],
    mirror: ["k & 7", "7 - (k & 7)"],
    same: ["k & 7", "k & 7"],
    shift: ["k & 7", "(k + 3) & 7"],
    five: ["k & 7", "(k * 5) & 7"],
  };
  const bodies = {
    readStoreRead: "const x = a[i] | 0; a[j] = (x + k) & 1023; s = (s + (a[i] | 0) - x) | 0;",
    readStoreReadPlain: "const x = a[i]; a[j] = (x + k) & 1023; s = (s + a[i] - x) | 0;",
    swapRead: "const x = a[i] | 0, y = a[j] | 0; a[i] = y; a[j] = x; s = (s + (a[i] | 0) * 3 - x) | 0;",
    twoStores: "const x = a[i] | 0; a[j] = (x ^ k) & 255; a[i] = (x + 1) & 255; s = (s + (a[j] | 0) + (a[i] | 0)) | 0;",
    increment: "a[j] = ((a[j] | 0) + 1) & 1023; const x = a[i] | 0; a[j] = ((a[j] | 0) + x) & 1023; s = (s + (a[i] | 0)) | 0;",
    compound: "const x = a[i] | 0; a[j] += 3; s = (s + (a[i] | 0) - x) | 0;",
  };
  const heads = {
    counted: ["for (let k = 0; k < n; k++)", "17"],
    length: ["for (let k = 0; k < a.length; k++)", "17"],
    outer: ["for (let r = 0; r < 3; r++) for (let k = 0; k < n; k++)", "9"],
  };
  const drawn: Shape[] = [];
  for (const [maker, make] of Object.entries(listsOfWholeNumbers))
    for (const [position, [i, j]] of Object.entries(positions))
      for (const [bodyName, body] of Object.entries(bodies))
        for (const [headName, [head, turns]] of Object.entries(heads)) {
          if (headName !== "counted" && (maker === "counted" || maker === "map")) continue;
          drawn.push({
            name: `one-loop-${maker}-${position}-${bodyName}-${headName}`,
            typed: true,
            text: `${make}\nfunction sweep(a: number[], n: number): number { let s = 0;\n  ${head} { const i = ${i}, j = ${j}; ${body} }\n  return s; }\nconsole.log(sweep(a, ${turns}), a.join());\n`,
          });
        }
  return drawn;
}

function readsBehindTheFirstStoreOfATurn(): Shape[] {
  const reads = {
    plus: "s = s + R;",
    minus: "s = R - s;",
    times: "s = s + R * 3;",
    or: "s = s + (R | 0);",
    half: "s = s + R / 2;",
  };
  const heads: Record<string, [string, string?]> = {
    nest: ["for (let j = 0; j < a.length; j++) for (let i = 0; i < a.length; i++)"],
    nestN: ["for (let j = 0; j < n; j++) for (let i = 0; i < a.length; i++)"],
    halves: ["for (let k = 0; k < 16; k++)", "const i = k & 7, j = (k >> 1) & 7;"],
    same: ["for (let i = 0; i < a.length; i++)", "const j = i;"],
    rev: ["for (let i = a.length - 1; i >= 0; i--)", "const j = 7 - i;"],
    of: ["for (const j of [0, 3, 7]) for (let i = 0; i < a.length; i++)"],
  };
  const bodies = {
    sr: "a[j] = (i + 1) | 0; R1 a[j] = (i + 2) | 0; R2",
    rsr: "R1 a[j] = (i + 2) | 0; R2",
    srs3: "a[j] = (i + 1) | 0; R1 a[j] = (i + 2) | 0; R2 a[j] = (i + 5) | 0; R1",
    cross: "a[j] = (i + 1) | 0; R1 a[i] = (j + 2) | 0; RJ",
    cond: "a[j] = (i + 1) | 0; R1 if (i & 1) a[j] = (i + 9) | 0; R2",
    inc: "a[j]++; R1 a[j]++; R2",
    swap: "{ const t = a[j]; a[j] = a[i]; a[i] = t; } R1 a[j] = (i + 2) | 0; R2",
  };
  const drawn: Shape[] = [];
  for (const [maker, make] of Object.entries(listsOfWholeNumbers)) {
    if (maker === "map") continue;
    for (const [readName, read] of Object.entries(reads))
      for (const [headName, [head, first = ""]] of Object.entries(heads))
        for (const [bodyName, body] of Object.entries(bodies)) {
          const turn = body.replace(/R1|R2/g, read.replace("R", "a[i]")).replace(/RJ/g, read.replace("R", "a[j]"));
          drawn.push({
            name: `behind-a-store-${maker}-${readName}-${headName}-${bodyName}`,
            typed: true,
            text: `${make}\nfunction f(a: number[], n: number): number { let s = 0;\n  ${head} { ${first} ${turn} }\n  return s; }\nconsole.log(f(a, 8), a.join());\n`,
          });
        }
  }
  drawn.push({
    name: "behind-a-store-one-list-under-two-names",
    typed: true,
    text: `${listsOfWholeNumbers.push}\nfunction g(x: number[], y: number[]): number { let s = 0;\n  for (let i = 0; i < x.length; i++) { if (i >= y.length) break;\n    y[i] = (i + 1) | 0; s = s + x[i]; y[i] = (i + 2) | 0; s = s + x[i]; }\n  return s; }\nconsole.log(g(a, a), a.join());\n`,
  });
  return drawn;
}

function everyKindOfStorageAndEveryWayToWrite(): Shape[] {
  const pushed = (element: string) => `const a = []; for (let i = 0; i < 8; i++) a.push(${element}); const b = a;`;
  const kinds: Record<string, [make: string, stored: string, asNumber: string, sort: "list" | "view"]> = {
    "whole-numbers": [pushed("i"), "(K) & 1023", "(X | 0)", "list"],
    "fractions": [pushed("i + 0.5"), "(K) * 0.25 + 0.5", "(X * 4)", "list"],
    "texts": [pushed("'s' + i"), "'t' + ((K) & 63)", "X.length * 7 + X.charCodeAt(X.length - 1)", "list"],
    "objects": [pushed("{ v: i }"), "{ v: (K) & 255 }", "X.v", "list"],
    "whole-then-fractions": [pushed("i"), "((K) & 3) === 3 ? (K) + 0.5 : (K) & 255", "(X * 2)", "list"],
    "whole-then-texts": [pushed("i"), "((K) & 7) === 5 ? 'x' + (K) : (K) & 255", "(typeof X === 'number' ? X : X.length * 100)", "list"],
    "a-literal": ["const a = [0, 1, 2, 3, 4, 5, 6, 7]; const b = a;", "(K) & 1023", "(X | 0)", "list"],
    "a-class-below-array": ["class L extends Array {} const a = new L(); for (let i = 0; i < 8; i++) a.push(i); const b = a;", "(K) & 1023", "(X | 0)", "list"],
    "int32-view": ["const a = new Int32Array(8); for (let i = 0; i < 8; i++) a[i] = i; const b = a;", "(K) & 1023", "X", "view"],
    "float64-view": ["const a = new Float64Array(8); for (let i = 0; i < 8; i++) a[i] = i + 0.5; const b = a;", "(K) * 0.25", "(X * 4)", "view"],
    "uint8-view": ["const a = new Uint8Array(8); for (let i = 0; i < 8; i++) a[i] = i; const b = a;", "(K) & 255", "X", "view"],
    "two-views-int32-uint32": ["const m = new ArrayBuffer(32), a = new Int32Array(m), b = new Uint32Array(m); for (let i = 0; i < 8; i++) a[i] = i;", "(K) & 1023", "X", "view"],
    "two-views-int32-float32": ["const m = new ArrayBuffer(32), a = new Int32Array(m), b = new Float32Array(m); for (let i = 0; i < 8; i++) a[i] = i;", "(K) * 0.5 + 1", "(X % 1009)", "view"],
    "two-views-float64-uint8": ["const m = new ArrayBuffer(64), a = new Float64Array(m), b = new Uint8Array(m); for (let i = 0; i < 8; i++) a[i] = i + 0.5;", "(K) & 255", "(Number.isFinite(X) ? Math.round(X * 8) % 1009 : 3)", "view"],
    "a-view-over-part": ["const w = new Int32Array(12), a = w.subarray(2, 10), b = w.subarray(0, 8); for (let i = 0; i < 12; i++) w[i] = i;", "(K) & 1023", "X", "view"],
  };
  const stores: Record<string, [store: string, fits: "both" | "list" | "view"]> = {
    "by-index": ["a[j] = V;", "both"],
    "by-index-through-another-name": ["b[j] = V;", "both"],
    "twice": ["a[j] = V; a[(j + 1) & 7] = V;", "both"],
    "compound": ["a[j] = a[j]; a[j] = V;", "both"],
    "by-fill": ["a.fill(V, j, j + 1);", "both"],
    "by-fill-through-another-name": ["b.fill(V, j, j + 1);", "both"],
    "by-copy-within": ["a.copyWithin(j, (j + 3) & 7, ((j + 3) & 7) + 1);", "both"],
    "by-reverse": ["a.reverse();", "both"],
    "by-set": ["a.set([V], j);", "view"],
    "by-splice": ["a.splice(j, 1, V);", "list"],
    "by-pop-and-push": ["const last = a.pop(); a.push(j === 7 ? V : last); if (j !== 7) a[j] = V;", "list"],
    "by-shift-and-unshift": ["a.unshift(a.pop());", "list"],
    "by-reflect-set": ["Reflect.set(a, j, V);", "both"],
    "by-a-swap-in-a-pattern": ["[a[i], a[j]] = [a[j], a[i]];", "both"],
    "in-a-function-called": ["lay(a, j, V);", "both"],
    "in-a-callback": ["[j].forEach((p) => { a[p] = V; });", "both"],
  };
  const reads = { "by-index": "a[i]", "by-at": "a.at(i)" };
  const storesReadByAtToo = ["by-index", "by-index-through-another-name", "by-fill"];
  const drawn: Shape[] = [];
  for (const [kind, [make, stored, asNumber, sort]] of Object.entries(kinds))
    for (const [storeName, [store, fits]] of Object.entries(stores)) {
      if (fits !== "both" && fits !== sort) continue;
      for (const [readName, read] of Object.entries(reads)) {
        if (readName === "by-at" && !storesReadByAtToo.includes(storeName)) continue;
        const written = store.replaceAll("V", stored.replaceAll("K", "k * 3 + 1"));
        const turn = `const i = k & 7, j = (k >> 1) & 7; const x = ${read}; ${written} const y = ${read}; s = (s + n(y) * 3 - n(x)) % 1000003;`;
        drawn.push({
          name: `every-kind-${kind}--${storeName}--read-${readName}`,
          typed: false,
          text: `${make}\nfunction n(X) { return ${asNumber}; }\nfunction lay(l, p, v) { l[p] = v; }\nfunction sweep(a, b, t) { let s = 0;\n  for (let k = 0; k < t; k++) { ${turn} }\n  return s; }\nconsole.log(sweep(a, b, 41), Array.from(a, n).join());\n`,
        });
      }
    }
  return drawn;
}

export const shapes = (): Shape[] => [
  ...twoPositionsInOneLoop(),
  ...readsBehindTheFirstStoreOfATurn(),
  ...everyKindOfStorageAndEveryWayToWrite(),
];
