// Small functions, each a few operators deep, run over every pair of 27 numbers at the ends of int32 and uint32: what a code generator chooses by cases: the width of an instruction, what it folds into an address,
// a comparison or an immediate, and what it takes for extended already.
//
//   widths    int32, uint32, integers wider than 32 bits and doubles; each made in the function (`x | 0`, `x >>> 0`, `a * 2097152 + v`) or handed in as such by every caller
//   absent    `number | undefined`, `number | null` and `boolean | undefined`, whose numbers include the neighbors of the least int32 and NaN with every payload a typed array can hold
//   operators + - * / % << >> >>> & | ^ ~ - with variables and with constants, Math.imul clz32 abs min max sign floor ceil round trunc sqrt fround, comparisons of every width and sign, && || ! ?:
//   meetings  what 32 bits gave is read as 64 (`((a << 1) >>> 0) + w`), what 64 bits gave as 32 (`(w | 0) < b`), as a double, as an index, as a shift count, as a divisor
//   memory    typed arrays of each element width and an array, read and written at an index that an operator gave
//   shapes    one expression; two that meet behind an if, of one width or of two; a loop that feeds itself; a switch; a test fused with its branch or kept as a value; a value kept across a call; two that may be absent and change places in a loop;
//             a call on one path only; the same expression, the same test or the same read twice, with a branch, a call or a write between
//   calls     half of the functions are called through one variable, half by name from a loop of their own
//
// One line a function: all its answers in one number. Always TypeScript: the mode `erased` gives the untyped form.
import type { Random } from "./random";

const prelude = `const ends = [0, 1, -1, 2, -2, 3, 7, 8, 31, 32, 33, 255, 256, 65535, 65536, 1073741823, 1073741824, 1073741825, 2147483646, 2147483647, -2147483648, -2147483647, -2147483646, -1073741824, -1073741825, 1431655765, -1431655766];
const contents = [0, 1, -1, 127, 128, -128, 255, 256, 32767, 32768, -32768, 65535, 2147483647, -2147483648, 4294967295, 0.5];
const i8 = new Int8Array(contents), u8 = new Uint8Array(contents), i16 = new Int16Array(contents), u16 = new Uint16Array(contents), i32 = new Int32Array(contents), u32 = new Uint32Array(contents); // prettier-ignore
const f32 = new Float32Array(contents), f64 = new Float64Array(contents), list = contents.slice(); // prettier-ignore
const scratch32 = new Int32Array(8), scratch8 = new Uint8Array(8), scratch16 = new Int16Array(8), scratch64 = new Float64Array(8), scratchList = [0, 0, 0, 0, 0, 0, 0, 0.5]; // prettier-ignore
const odd = new Float64Array(
  new BigUint64Array([0x7ffa000000000000n, 0x7ffb000000000000n, 0x7ffc000000000000n, 0xfffa000000000000n, 0x7ff8000000000000n, 0x7ff0000000000000n, 0x8000000000000000n, 0xfffe000000000001n]).buffer,
);
let calls = 0;
function tick(): void {
  if (++calls % 9973 === 0)
    try {
      throw calls;
    } catch {}
}
function fold(value: number | boolean | null | undefined): number {
  if (typeof value !== "number") return value === undefined ? 7 : value === null ? 11 : value ? 3 : 5;
  return Object.is(value, -0) ? 13 : value !== value ? 17 : value === Infinity ? 19 : value === -Infinity ? 23 : ((value * 1000) | 0) ^ ((value / 4294967296) | 0) ^ (value | 0);
}
type Tried = (x: number, y: number, p: number, q: number, r: number, m: number | undefined, n: number | null, o: boolean | undefined) => number | boolean | null | undefined;
function run(name: string, tried: Tried): void {
  let hash = 0;
  for (let i = 0; i < ends.length; i++)
    for (let j = 0; j < ends.length; j++) hash = (Math.imul(hash, 31) + fold(tried(ARGUMENTS))) | 0;
  console.log(name + " " + (hash >>> 0).toString(16));
}
`;

const given = "ends[i], ends[j], ends[j] | 0, ends[i] >>> 0, (ends[i] | 0) * 2097152 + (ends[j] >>> 0), j % 3 ? ends[i] | 0 : undefined, i % 3 ? (j & 1 ? ends[j] * 0.5 : odd[i & 7]) : null, (i + j) % 3 ? i > j : undefined";

export function generate(random: Random): string {
  const below = (limit: number) => random.below(limit);
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude.replace("ARGUMENTS", given)];
  const count = () => pick(["1", "1", "2", "2", "3", "3", "4", "8", "15", "16", "24", "31", "0"]);
  const smallInt = () => pick(["1", "2", "3", "4", "5", "7", "8", "10", "16", "255", "256", "-1", "-2", "-8", "65535", "65536"]);
  const endOfInt = () => pick(["2147483647", "-2147483648", "-2147483647", "2147483646", "1073741824", "-1073741824", "-1", "0", "1", "127", "128", "-128", "-129", "32767", "32768", "1431655765"]);
  const endOfWide = () => pick(["4294967295", "4294967296", "4294967297", "2147483648", "-2147483649", "-4294967296", "9007199254740991", "-9007199254740991", "4503599627370496", "1099511627776", "281474976710655"]);
  // Never `l < r`: TypeScript reads `(a) < ((b) > (c) ? d : e)` as a call with type arguments.
  const compared = (l: string, r: string) => {
    const relation = pick(["<", ">", "<=", ">=", "===", "!=="]);
    return relation === "<" ? `${r} > ${l}` : `${l} ${relation} ${r}`;
  };

  for (let number = 0, functions = random.between(30, 70); number < functions; number++) {
    // A variable of the shape in hand: `t` once it is declared.
    const more: Record<"I" | "U" | "W" | "D", string[]> = { I: [], U: [], W: [], D: [] };
    const leaf = (width: "I" | "U" | "W" | "D") => pick([...{ I: ["a", "b", "p"], U: ["u", "v", "q"], W: ["w", "z", "r"], D: ["d", "e", "x"] }[width], ...more[width], ...more[width]]);

    const I = (depth: number): string => {
      if (depth <= 0) return leaf("I");
      const [l, r] = [I(depth - 1), I(depth - below(2) - 1)];
      // prettier-ignore
      return pick([
        () => `((${l} ${pick(["+", "-", "*"])} ${r}) | 0)`, () => `((${l} ${pick(["+", "-", "*"])} ${pick([smallInt(), endOfInt()])}) | 0)`, () => `Math.imul(${l}, ${pick([r, smallInt(), endOfInt()])})`, () => `(${l} ${pick(["&", "|", "^"])} ${pick([r, r, smallInt(), endOfInt()])})`,
        () => `(${l} ${pick(["<<", ">>"])} ${count()})`, () => `(${l} ${pick(["<<", ">>"])} ${pick([r, `(${r} & 31)`, U(depth - 1)])})`, () => `((${l} >>> ${pick([count(), r])}) | 0)`, () => `~${l}`, () => `(-${l} | 0)`, () => `(${U(depth - 1)} | 0)`, () => `(${W(depth - 1)} | 0)`, () => `(${D(depth - 1)} | 0)`,
        () => `((${l} ${pick(["/", "%"])} ${pick([r, r, smallInt(), endOfInt(), `(${r} | 1)`])}) | 0)`, () => `((${U(depth - 1)} ${pick(["/", "%"])} ${pick([smallInt(), U(depth - 1), r])}) | 0)`, () => `(${C(depth - 1)} ? ${l} : ${pick([r, endOfInt()])})`, () => `Math.clz32(${pick([l, U(depth - 1)])})`,
        () => `Math.${pick(["min", "max"])}(${l}, ${pick([r, endOfInt()])})`, () => `(Math.abs(${l}) | 0)`, () => `Math.sign(${l})`, () => `${pick(["i8", "i16", "i32", "u8", "u16"])}[${index(depth - 1)}]`, () => `(${pick(["u32", "f32", "f64", "list"])}[${index(depth - 1)}] | 0)`, () => `+(${C(depth - 1)})`,
        () => `((${W(depth - 1)} ${pick(["%", "/"])} ${pick(["256", "65536", "4294967296", "3", "-1"])}) | 0)`, () => `(${W(depth - 1)} & ${pick([smallInt(), endOfInt(), r])})`, () => `(${W(depth - 1)} >> ${count()})`, () => `(${U(depth - 1)} ${pick(["&", "^", "|"])} ${pick([l, endOfInt()])})`,
        () => `((${MI(depth - 1)} ?? ${l}) | 0)`, () => `(((${MD(depth - 1)} ?? 0.5) * 2) | 0)`,
      ])();
    };
    const U = (depth: number): string => {
      if (depth <= 0) return leaf("U");
      const [l, i] = [U(depth - 1), I(depth - 1)];
      // prettier-ignore
      return pick([
        () => `(${i} >>> 0)`, () => `(${pick([l, i])} >>> ${pick([count(), I(depth - 1)])})`, () => `((${l} ${pick(["+", "-", "*"])} ${pick([i, U(depth - 1), smallInt(), endOfInt()])}) >>> 0)`, () => `((${pick([l, i])} << ${count()}) >>> 0)`, () => `(${W(depth - 1)} >>> 0)`, () => `(${D(depth - 1)} >>> 0)`,
        () => `${pick(["u32", "u16", "u8"])}[${index(depth - 1)}]`, () => `(${C(depth - 1)} ? ${l} : ${pick([U(depth - 1), "4294967295", "2147483648", "0"])})`, () => `(~${l} >>> 0)`, () => `((${l} ${pick(["&", "|", "^"])} ${pick([i, endOfInt()])}) >>> 0)`, () => `(Math.imul(${l}, ${pick([i, smallInt()])}) >>> 0)`,
        () => `((${l} ${pick(["/", "%"])} ${pick([smallInt(), U(depth - 1)])}) >>> 0)`,
      ])();
    };
    const W = (depth: number): string => {
      if (depth <= 0) return leaf("W");
      const [l, i, u] = [W(depth - 1), I(depth - 1), U(depth - 1)];
      // prettier-ignore
      return pick([
        () => `(${i} ${pick(["+", "-", "*"])} ${I(depth - 1)})`, () => `(${u} ${pick(["+", "-"])} ${pick([U(depth - 1), i])})`, () => `(${l} ${pick(["+", "-"])} ${pick([i, u, endOfWide(), endOfInt(), W(depth - 1)])})`, () => `(${pick([i, u])} * ${pick(["2", "4", "8", "3", "5", "9", "-1", "65536", "4294967296", "2147483647"])})`,
        () => `(${pick([i, u])} ${pick(["+", "-"])} ${pick([endOfWide(), endOfInt()])})`, () => `(-${pick([i, u, l])})`, () => `(${C(depth - 1)} ? ${pick([l, i, u])} : ${pick([l, i, u, endOfWide()])})`, () => `Math.floor(${l} / ${pick(["2", "3", "4294967296", "65536"])})`, () => `(${l} % ${pick(["4294967296", "65536", "3", "1000003", "-7"])})`,
        () => `Math.abs(${pick([l, i])})`, () => `Math.${pick(["min", "max"])}(${l}, ${pick([i, u, endOfWide()])})`, () => `(${l} * ${pick(["2", "4", "8", "3"])} % 9007199254740991)`, () => `(${u} * ${pick(["2", "4", "8"])} + ${pick([i, u, l])})`, () => `(${i} * 4294967296 + ${u})`, () => `Math.trunc(${l} / ${pick(["2", "7", "-3"])})`,
      ])();
    };
    const D = (depth: number): string => {
      if (depth <= 0) return leaf("D");
      const [l, i] = [D(depth - 1), I(depth - 1)];
      // prettier-ignore
      return pick([
        () => `(${l} ${pick(["+", "-", "*", "/"])} ${pick([D(depth - 1), i, U(depth - 1), "0.5", "-0", "3", "1e300", "4294967296.5"])})`, () => `(${i} / ${pick([I(depth - 1), smallInt(), "0"])})`, () => `(${W(depth - 1)} / ${pick(["3", "0.5", "4294967296"])})`, () => `(-${l})`, () => `(${U(depth - 1)} * 0.5)`,
        () => `Math.${pick(["floor", "ceil", "round", "trunc", "fround", "abs", "sign"])}(${l})`, () => `Math.sqrt(Math.abs(${l}))`, () => `Math.${pick(["min", "max"])}(${l}, ${pick([D(depth - 1), i, "-0", "0", "NaN"])})`, () => `(${C(depth - 1)} ? ${l} : ${pick([D(depth - 1), i, U(depth - 1), W(depth - 1), "NaN", "-0"])})`,
        () => `${pick(["f64", "f32", "list"])}[${index(depth - 1)}]`, () => `(${l} % ${pick([D(depth - 1), "3", "0.5", "-2"])})`, () => `(${MD(depth - 1)} ?? ${l})`, () => `odd[${i} & 7]`,
      ])();
    };
    const C = (depth: number): string => {
      const any = () => pick([I, I, U, W, D])(Math.max(0, depth));
      const i = I(Math.max(0, depth));
      // prettier-ignore
      return pick([
        () => compared(`${i}`, `${pick([I(Math.max(0, depth)), endOfInt(), smallInt()])}`), () => compared(`${U(Math.max(0, depth))}`, `${pick([U(Math.max(0, depth)), "2147483647", "2147483648", "4294967295", smallInt(), i])}`), () => compared(`${W(Math.max(0, depth))}`, `${pick([W(Math.max(0, depth)), endOfWide(), endOfInt(), i])}`),
        () => compared(`${D(Math.max(0, depth))}`, `${pick([D(Math.max(0, depth)), "0", "0.5", i])}`), () => `(${i} & ${pick(["1", "2", "8", "128", "255", "256", "65536", "1073741824", "-2147483648", I(0)])}) ${pick(["===", "!=="])} 0`, () => `((${i} >>> ${pick([count(), I(0)])}) & 1) ${pick(["===", "!=="])} ${pick(["0", "1"])}`,
        () => `!${any()}`, () => `!!${any()}`, () => compared(`(${W(Math.max(0, depth))} | 0)`, pick([i, `(${W(0)} | 0)`, endOfInt()])), () => compared(`(${W(Math.max(0, depth))} >>> 0)`, `${pick([U(0), "2147483648"])}`), () => compared(`${any()}`, `${any()}`),
        () => `${MI(Math.max(0, depth))} ${pick(["===", "!=="])} undefined`, () => `${MD(Math.max(0, depth))} ${pick(["===", "!=="])} null`, () => `${MB(Math.max(0, depth))} ${pick(["===", "!=="])} ${pick(["undefined", "true", "false"])}`, () => `(${MB(Math.max(0, depth))} ?? ${i} > 0)`,
        () => `${MI(Math.max(0, depth))} === ${pick([i, endOfInt(), "-2147483646", "-2147483645"])}`,
        ...(depth > 0 ? [() => `(${C(depth - 1)} ${pick(["&&", "||"])} ${C(depth - 1)})`, () => `!(${C(depth - 1)})`] : []),
      ])();
    };
    // What may be absent. Each is read through a cast to its type, so that no narrowing makes a later read an error.
    const absent: Record<"MI" | "MD" | "MB", string[]> = { MI: [], MD: [], MB: [] };
    function MI(depth: number): string {
      const type = "number | undefined";
      if (depth <= 0) return `(${pick(["m", ...absent.MI, ...absent.MI])} as ${type})`;
      return `((${pick([`${C(depth - 1)} ? ${I(depth - 1)} : undefined`, `${C(depth - 1)} ? ${MI(depth - 1)} : ${pick([I(depth - 1), "-2147483647", "-2147483646", "-2147483645", "-2147483648"])}`, `${MI(depth - 1)} === undefined ? ${I(depth - 1)} : undefined`, `${MI(depth - 1)} ?? ${MI(depth - 1)}`])}) as ${type})`;
    }
    function MD(depth: number): string {
      const type = "number | null";
      if (depth <= 0) return `(${pick(["n", ...absent.MD, ...absent.MD])} as ${type})`;
      return `((${pick([`${C(depth - 1)} ? ${D(depth - 1)} : null`, `${C(depth - 1)} ? ${MD(depth - 1)} : ${pick([D(depth - 1), `odd[${I(0)} & 7]`, "NaN", "-0"])}`, `${MD(depth - 1)} === null ? ${D(depth - 1)} : null`, `${MD(depth - 1)} ?? ${MD(depth - 1)}`])}) as ${type})`;
    }
    function MB(depth: number): string {
      const type = "boolean | undefined";
      if (depth <= 0) return `(${pick(["o", ...absent.MB, ...absent.MB])} as ${type})`;
      return `((${pick([`${C(depth - 1)} ? ${C(depth - 1)} : undefined`, `${C(depth - 1)} ? ${MB(depth - 1)} : ${C(depth - 1)}`, `${MB(depth - 1)} === undefined ? ${C(depth - 1)} : undefined`])}) as ${type})`;
    }
    // In bounds whatever the operators gave: 16 elements to read.
    function index(depth: number): string {
      const [i, u] = [I(Math.max(0, depth)), U(Math.max(0, depth))];
      return pick([`${i} & 15`, `${u} & 15`, `${u} % 16`, `(${i} << ${pick(["1", "2", "3"])}) & 15`, `((${i} << ${pick(["1", "2", "3"])}) >>> 0) % 16`, `(${i} >>> ${pick(["28", "29", "30"])})`, `(${u} >>> 28)`, `(${W(Math.max(0, depth))} & 15)`, `Math.abs(${i} % 16)`]);
    }
    const of = { I, U, W, D };
    const width = () => pick(["I", "I", "U", "U", "W", "W", "D"] as const);
    const depth = random.between(1, 3);
    const any = (deep = depth) => of[width()](deep);
    const joined = pick(["+", "-", "*", ">", "===", "%"]);

    let body: string;
    switch (below(22)) {
      case 0: case 1: body = `return ${any(depth + 1)};`; break; // prettier-ignore
      case 2: case 3: {
        const [first, second] = [width(), below(3) ? undefined : width()];
        body = `let t = ${of[first](depth)};\n  if (${C(depth - 1)}) t = ${of[second ?? first](depth)};\n  `;
        if (!second || second === first) more[first].push("t");
        body += `return ${pick([`t ${joined} ${any()} ? 1 : 0`, `t + ${W(depth)}`, `(t | 0) + ${W(depth - 1)}`, `(t >>> 0) + ${W(depth - 1)}`, `t * 0.5`, `t`, any(), `u8[${!second && first !== "D" ? "t & 15" : "(t | 0) & 15"}] + t`])};`;
        break;
      }
      case 4: {
        const first = width();
        const start = of[first](depth - 1);
        more[first].push("t");
        body = `let t = ${start};\n  for (let k = 0; k < ${random.between(2, 4)}; k++) t = ${of[first](depth)};\n  return ${pick(["t", `t + ${W(1)}`, any()])};`;
        break;
      }
      case 5: {
        const labels = random.sample(["0", "1", "2", "3", "4", "5", "6", "7", "8", "15", "16", "31", "32", "33", "63", "64", "-1", "-2", "255", "65536", "2147483647", "-2147483648", "1073741824"], random.pick([1, 2, 3, 5, 8, 12]));
        const targets = random.between(1, 3);
        const sharesDefault = below(3) ? -1 : below(targets);
        body = `switch (${pick([I(depth), `${I(depth)} & ${pick(["7", "63", "255"])}`, U(depth), W(depth - 1), D(0)])}) {\n${Array.from({ length: targets }, (_, target) => `    ${labels.filter((_, at) => at % targets === target).map(each => `case ${each}:`).join(" ")}${target === sharesDefault ? " default:" : ""}\n      return ${any(depth - 1)};`).join("\n")}\n  }\n  return ${any(depth - 1)};`;
        break;
      }
      case 6: case 7: body = `if (${C(depth)}) return ${any(depth - 1)};\n  ${below(2) ? `if (${C(depth - 1)}) return ${any(depth - 1)};\n  ` : ""}return ${any(depth - 1)};`; break; // prettier-ignore
      case 8: body = `const t = ${C(depth)};\n  const s = ${C(depth - 1)};\n  ${below(2) ? "tick();\n  " : ""}return (t ? ${pick(["1", I(1)])} : ${pick(["0", I(1)])}) + (s ? 2 : 0) + (t === s ? 4 : 0) + (t && s ? 8 : 0);`; break; // prettier-ignore
      case 9: {
        const [memory, stored] = pick([["scratch32", any()], ["scratch8", any()], ["scratch16", any()], ["scratch64", any()], ["scratchList", any()], ["scratch32", I(depth)], ["scratch8", U(depth)], ["scratch64", W(depth)]]);
        const at = () => pick([`${I(depth - 1)} & 7`, `${U(depth - 1)} & 7`, `(${I(0)} << ${pick(["1", "2"])}) & 7`, `${U(0)} >>> 29`, `((${I(0)} << 1) >>> 0) % 8`]);
        body = `${memory}[${at()}] = ${stored};\n  ${below(2) ? `${memory}[${at()}] = ${any(depth - 1)};\n  ` : ""}return ${memory}[${at()}] + ${memory}[${below(8)}];`;
        break;
      }
      case 10: {
        const [first, second] = [width(), width()];
        body = `const t = ${of[first](depth)};\n  const s = ${of[second](depth)};\n  tick();\n  `;
        more[first].push("t");
        more[second].push("s");
        body += `return ${any()};`;
        break;
      }
      case 11: case 12: {
        const [kind, type, make] = pick([["MI", "number | undefined", MI], ["MD", "number | null", MD], ["MB", "boolean | undefined", MB]] as const);
        body = `let t: ${type} = ${make(depth)};\n  let s: ${type} = ${make(depth)};\n  for (let k = 0; k < ${random.between(1, 3)}; k++) {\n    const kept: ${type} = t;\n    t = s;\n    s = kept;\n    ${pick(["tick();", "", `if (${C(0)}) s = ${make(depth - 1)};`])}\n  }\n  `;
        absent[kind].push("t", "s");
        body += `return ${pick([`fold(t) * 31 + fold(s)`, "t", "s", any(), make(1)])};`;
        break;
      }
      case 13: {
        const [kind, type, make] = pick([["MI", "number | undefined", MI], ["MD", "number | null", MD], ["MB", "boolean | undefined", MB]] as const);
        body = `let t: ${type} = ${make(depth)};\n  if (${C(depth - 1)}) t = ${make(depth)};\n  ${below(2) ? "tick();\n  " : ""}`;
        absent[kind].push("t");
        body += `return ${pick(["t", make(1), any(), `fold(t) + ${I(1)}`])};`;
        break;
      }
      case 14: {
        // A call on one path only: the other needs no frame.
        const [kept, early] = [any(), any(depth - 1)];
        body = pick([`if (${C(depth - 1)}) return ${early};\n  const t = ${kept};\n  tick();\n  return t + ${any(depth - 1)};`, `const t = ${kept};\n  if (${C(depth - 1)}) {\n    tick();\n    return t + ${early};\n  }\n  return t;`, `if (${C(0)}) return ${leaf("I")};\n  if (${C(0)}) return ${leaf("D")};\n  tick();\n  return ${kept};`]);
        break;
      }
      case 15: case 16: {
        // The same expression twice: in one block, on both sides of a branch, on both sides of a call.
        const twice = pick([any(), D(depth), `Math.sqrt(Math.abs(${D(depth - 1)}))`, `Math.floor(${D(depth - 1)})`, `${pick(["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64", "list"])}[${index(depth - 1)}]`, `Math.imul(${I(depth - 1)}, ${I(0)})`, `((${I(depth - 1)} / ${I(0)}) | 0)`]);
        body = pick([`return ${twice} + ${twice};`, `const t = ${twice};\n  if (${C(depth - 1)}) return t - ${twice};\n  return t + ${twice} * 3;`, `const t = ${twice};\n  tick();\n  return t * 3 + ${twice};`, `let t = 0;\n  for (let k = 0; k < 3; k++) t += ${twice};\n  return t;`]);
        break;
      }
      case 17: case 18: {
        // A read, a write that may hit the same element on one path, the read again.
        const [memory, stored] = pick([["scratch32", I(depth)], ["scratch8", any()], ["scratch16", any()], ["scratch64", any()], ["scratchList", any()]]);
        const at = () => pick([`${I(0)} & 7`, `${U(0)} & 7`, `${below(8)}`, `${below(8)}`, `${U(0)} >>> 29`]);
        const [read, write] = [at(), at()];
        body = `const t = ${memory}[${read}];\n  ${pick([`if (${C(depth - 1)}) ${memory}[${write}] = ${stored};`, `${memory}[${write}] = ${stored};`, `if (${C(depth - 1)}) tick();\n  else ${memory}[${write}] = ${stored};`])}\n  return t * 3 + ${memory}[${read}];`;
        break;
      }
      case 19: case 20: {
        // The same test again, where the first answer decides the second.
        const test = C(depth - 1);
        const first = width();
        body = `let t = ${of[first](depth - 1)};\n  if (${test}) t = ${of[first](depth)};\n  ${below(2) ? "tick();\n  " : ""}`;
        more[first].push("t");
        body += pick([`if (${test}) return ${any()};\n  return ${any()};`, `if (!(${test})) return ${any()};\n  return ${any()};`, `return (${test} ? ${any(depth - 1)} : ${any(depth - 1)}) + (${test} ? 1 : 2);`, `if (${test} && ${C(0)}) return ${any(depth - 1)};\n  if (${test} || ${C(0)}) return ${any(depth - 1)};\n  return t;`]);
        break;
      }
      default: {
        const first = width();
        body = `let t = ${of[first](depth - 1)};\n  let s = ${of[first](depth - 1)};\n  if (${C(depth - 1)}) {\n    const kept = t;\n    t = s;\n    s = kept;\n  } else if (${C(0)}) t = ${of[first](depth)};\n  `;
        more[first].push("t", "s");
        body += `return ${any()};`;
      }
    }
    const head = `(x: number, y: number, p: number, q: number, r: number, m: number | undefined, n: number | null, o: boolean | undefined): number | boolean | null | undefined {
  const a = x | 0, b = y | 0, u = x >>> 0, v = y >>> 0, w = a * 2097152 + v, z = b * 4294967296 + u, d = x * 0.5, e = y / 3; // prettier-ignore
  ${body}
}`;
    if (below(2)) text.push(`run("g${number}", function ${head});`);
    else
      text.push(`function g${number}${head}
{
  let hash = 0;
  for (let i = 0; i < ends.length; i++)
    for (let j = 0; j < ends.length; j++) hash = (Math.imul(hash, 31) + fold(g${number}(${given}))) | 0;
  console.log("g${number} " + (hash >>> 0).toString(16));
}`);
  }
  return text.join("\n");
}
