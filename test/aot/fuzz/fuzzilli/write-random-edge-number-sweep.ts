// Generates random programs on numbers at the edges of every representation: every arithmetic form over them, in short loops, copies, closures, fields, lists, views, generators and recursion.
// Each function is called with one to three pairs of numbers that the build sees, with hidden ones, or with both. The program number is the random seed.
//
//   bun write-random-edge-number-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<functions>-functions.mjs or .ts
//   bun write-random-edge-number-sweep.ts count
import { Draws, writePrograms } from "./draw-by-seed.ts";

const edges = ["2 ** 31", "2 ** 31 - 1", "-(2 ** 31)", "-(2 ** 31) - 1", "2 ** 31 + 1", "2 ** 32", "2 ** 32 - 1", "2 ** 32 + 1", "-(2 ** 32)", "2 ** 30", "2 ** 52", "2 ** 52 + 0.5", "2 ** 52 + 1", "2 ** 53", "2 ** 53 - 1", "2 ** 53 - 2", "2 ** 53 + 2", "-(2 ** 53)", "-(2 ** 53) + 1", "-(2 ** 53) - 2", "2 ** 54", "2 ** 62", "2 ** 63", "-(2 ** 63)", "2 ** 63 - 1024", "2 ** 64", "2 ** 64 - 2048", "1e21", "1e300", "1.7976931348623157e308", "-1.7976931348623157e308", "5e-324", "-5e-324", "2.2250738585072014e-308", "1e-300", "-0", "NaN", "Infinity", "-Infinity", "0.1", "0.5", "-0.5", "2147483647.5", "4294967295.5", "-2147483648.5", "9007199254740991", "9007199254740993", "4503599627370497.5", "2 ** 48", "2 ** 33 + 1", "65535", "65536", "-65536", "2 ** 24 + 1", "2 ** 23 + 0.5"]; // prettier-ignore
const small = ["0", "1", "2", "3", "5", "7", "-1", "-3", "10", "1.5", "2.5", "4", "8", "16", "100", "0.25", "-7", "12", "31", "32", "33", "255", "256"]; // prettier-ignore
const mostDrawnEdges = ["2 ** 31", "2 ** 31 - 1", "-(2 ** 31)", "2 ** 32", "2 ** 32 - 1", "2 ** 53", "2 ** 53", "2 ** 53 - 1", "2 ** 53 - 2", "-(2 ** 53)", "2 ** 53 + 2", "2 ** 52 + 0.5", "1e21", "5e-324", "-0", "NaN", "Infinity", "0.5", "2 ** 63", "2 ** 64", "-(2 ** 53) + 1", "2 ** 52", "2 ** 54"]; // prettier-ignore
const operands = ["y + i", "y + i", "y - i", "i - y", "y * i", "y + i * w", "y + w", "y * w + i", "y - w", "y + i + w", "y + (i - 1)", "(y + i) * 2", "(y + i) / 2", "y + i / 2", "y", "(y | 0) + i", "(y >>> 0) + i", "y + (w | 0)", "-y + i", "-(y + i)", "y * 0.5 + i", "y + i + 1", "(y + i) - 1", "y * y", "y + i - y", "w + i", "w - i", "w * i", "(y + i) % w", "Math.floor(y) + i", "Math.trunc(y) - i", "+y + i", "y + +i", "(y + i) + (w + i)", "y * (i + 1)", "y / (i + 1)", "i + 0.5 + y"]; // prettier-ignore
const forms = ["(#) % w", "(#) % w", "(#) % 3", "(#) % 2", "(#) % 8", "(#) % 10", "(#) % -3", "(#) % 0.5", "(#) % 7 + i", "((#) % w + w) % w", "(#) / w", "Math.floor((#) / w)", "Math.trunc((#) / 3)", "((#) / 2) | 0", "((#) / w) | 0", "(#) | 0", "(#) >>> 0", "~~(#)", "(#) & 7", "(#) & w", "(#) ^ i", "(#) << 1", "(#) << i", "(#) >> 1", "(#) >>> i", "-(#)", "(#) ** 2", "Math.imul(#, 3)", "Math.imul(#, w)", "(#) % w === 0 ? 1 : 2", "(#) % 2 === 1 ? 1 : 2", "(#) % 4 == 0 ? 1 : 0", "(#) < w ? 1 : 2", "(#) >= y ? 1 : 2", "(#) === y ? 1 : 2", "(#) > 2 ** 53 ? 1 : 2", "(#) == (#) ? 1 : 2", "Math.min(#, w)", "Math.max(#, w)", "Math.min(#, 0)", "Math.max(0, #)", "Math.abs(#)", "Math.round(#)", "Math.floor(#)", "Math.ceil(#)", "Math.trunc(#)", "Math.sign(#)", "Math.sqrt(#)", "Math.fround(#)", "Math.clz32(#)", "(#) - (y)", "(#) + 0.5", "(#) * 3", "(#) + 1 - (#)", "Number.isInteger(#) ? 1 : 2", "Number.isSafeInteger(#) ? 1 : 2", "Object.is(#, -0) ? 1 : 2", "1 / (#)", "(#) * 0", "(#) - (#)", "(# | 0) === (#) ? 1 : 2", "((#) >>> 0) === (#) ? 1 : 2", "((#) | 0) % 5", "((#) >>> 0) % 5", "((#) & 1) + ((#) % 2)", "parseInt(String(#))", "(#).toString().length", "list[(#) & 3]", "list[(#) % 4]", "list[(#) % w]", "list[(#) - (y)]", "list[#] === undefined ? 1 : 2", "view[(#) & 3]", "view[(#) % 4] === undefined ? 1 : 2", "f64[(#) & 1]", "(v8[0] = #, v8[0])", "(v32[0] = #, v32[0])", "(u32[0] = #, u32[0])", "(f64[0] = #, f64[0])", "(f32[0] = #, f32[0])", "(c8[0] = #, c8[0])", "(v16[0] = #, v16[0])", "Number(BigInt.asIntN(32, BigInt(Number.isFinite(#) ? Math.trunc(#) : 0)))", "String.fromCharCode(#).charCodeAt(0)", '"abcdef".charCodeAt((#) % 6)', "[1, 2, 3].at((#) % 3) ?? 9", "Math.hypot(#, 1)", "(#) ? 1 : 2", "!(#) ? 1 : 2", "(#) || 7", "(#) && 7", "Number((#).toFixed(0))", "new Date(#).getTime()"]; // prettier-ignore
const steps = ["s += #;", "s = s * 10 + #;", "s -= #;", "s = (s + #) | 0;", "s = s ^ #;", "s = Math.max(s, #);", "s = s + (#) % 9;", "s += # > 0 ? 1 : 0;", "o.push(#);", "o.push(#);", "o.push(#);", "s = # + s * 2;", "s = (s * 31 + #) >>> 0;", "if (# > s) s = #;", "s = s + # - 1;", 't += "," + #;']; // prettier-ignore
const loops = ["for (let i = 0; i < K; i++) { B }", "for (let i = 0; i < K; i++) { B }", "for (let i = K; i > 0; i--) { B }", "for (let j = 0; j < 2; j++) for (let i = 0; i < K; i++) { B }", "for (let i = 0; i < K; i += 2) { B }", "let i = 0; while (i < K) { B i++; }", "let i = 0; do { B } while (++i < K);", "for (const i of [0, 1, 2]) { B }", "for (let i = 0; i < K; i++) { if (i === 1) { B } else { B2 } }", "for (let i = 1; i <= K; i++) { B y = y + 1; }", "for (let i = 0; i < K; i++) { B y--; }", "for (let i = 0; i < K; i++) { B y += w; }", "for (let i = 0; i < K; i++) { B y *= 2; }", "for (let i = 0; i < K; i++) { B w++; }", "for (let i = 0, n = 0; n < K; n++, i += 3) { B }", "for (let i = 0; i < K; i++) { const z = y + i; B if (z > 2 ** 53) s++; }", "for (let i = 0; i < K; i++) { try { B } finally { s++; } }", "const i = 1; B", "[0, 1, 2].forEach(i => { B });", "for (let k = y, i = 0; i < K; i++, k++) { B s += k % 5; }", "for (let k = y, i = 0; i < K; i++, k--) { B o.push(k); }", "for (let i = 0; i < K; i++) { let z = y; z++; z += i; B o.push(z - y); }", "for (let i = 0; i < K; i++) { const q = y % w; B o.push(q + i); }"]; // prettier-ignore
const mostDrawnOperands = ["y + i", "y + i", "y + i", "y - i", "y * i", "y + w", "y + i * w", "y * w", "(y + i) * 2", "y + i + w", "y - w", "i - y", "y + 1", "y * 3 + i", "y"]; // prettier-ignore
const mostDrawnForms = ["(#) % w", "(#) % w", "(#) % w", "(#) % 3", "(#) % 2", "(#) % 10", "(#) / w", "Math.floor((#) / w)", "((#) / w) | 0", "(#) | 0", "(#) >>> 0", "(#) & w", "(#) << i", "-(#)", "(#) < w ? 1 : 2", "(#) === y ? 1 : 2", "Math.min(#, w)", "Math.max(#, w)", "Math.abs(#)", "Math.round(#)", "Math.trunc(#)", "Math.imul(#, w)", "list[(#) % w]", "list[(#) & 3]", "(v32[0] = #, v32[0])", "(u32[0] = #, u32[0])", "#", "#", "(#) - y", "(#) * w", "(#) + w", "(#) % w + w", "((#) % w + w) % w", "(#) ** 2"]; // prettier-ignore

// In a table `#` is the operand or the formula, `K` the bound of a loop, `B` a step and `B2` another.
function write(seed: number): { name: string; text: string } {
  const draws = new Draws(seed);
  const { next, pick } = draws;
  const isTyped = next() < 0.75;
  const typed = (type: string) => (isTyped ? ": " + type : "");
  const first = () => (next() < 0.5 ? pick(mostDrawnEdges) : next() < 0.2 ? pick(edges) : pick(small));
  const second = () => (next() < 0.72 ? pick(small) : next() < 0.7 ? pick(mostDrawnEdges) : pick(edges));
  const formula = () => {
    const operand = pick(next() < 0.75 ? mostDrawnOperands : operands);
    return pick(next() < 0.7 ? mostDrawnForms : forms).replaceAll("#", () => operand);
  };
  const step = () => {
    const text = formula();
    return pick(steps).replaceAll("#", () => `(${text})`);
  };
  function writeFunction(at: number): { text: string; calls: string[] } {
    const loop = pick(loops)
      .replaceAll("K", pick(["2", "2", "3", "4", "1", "5", "8"]))
      .replaceAll("B2", step)
      .replaceAll(/\bB\b/g, step);
    const before = `let s${typed(next() < 0.25 ? "any" : "number")} = ${pick(["0", "0", "0", "y", "0.5", "-0"])}, t${typed("string")} = "";\n  const o${typed("any[]")} = [];`;
    const behind = `return o.length ? o.map(show).join() + "|" + show(s) + t : show(s) + t;`;
    const inside = `${before}\n  ${loop}\n  ${behind}`;
    const name = "h" + at;
    const number = pick(["number", "number", "number", "any"]);
    const parameters = `y${typed(number)}, w${typed(number)}`;
    const pairs = draws.several(pick([1, 2, 2, 2, 3]), () => [first(), second()]);
    const cast = isTyped ? " as any" : "";
    let call = (y: string, w: string) => `${name}(${y}, ${w})`;
    let text: string;
    const form = next();
    if (form < 0.34) text = `function ${name}(${parameters})${typed("string")} {\n  ${inside}\n}`;
    else if (form < 0.44) text = `const ${name} = (${parameters})${typed("string")} => {\n  ${inside}\n};`;
    else if (form < 0.54) {
      const calling = pick(loops.filter(one => !one.includes("B2")))
        .replaceAll("K", pick(["2", "3", "4"]))
        .replaceAll(/\bB\b/g, () => pick([`s += get${at}(y + i, w, i);`, `o.push(get${at}(y, w, i));`, `o.push(get${at}(y - i, w + i, i));`, `s = s * 10 + get${at}(y + i, w, 1);`])); // prettier-ignore
      text = `function get${at}(y${typed("number")}, w${typed("number")}, i${typed("number")})${typed("any")} {\n  return ${formula()};\n}\nfunction ${name}(${parameters})${typed("string")} {\n  ${before}\n  ${calling}\n  ${behind}\n}`;
    } else if (form < 0.62) {
      text = `function make${at}(${parameters}) {\n  return () => {\n  ${inside}\n  };\n}`;
      call = (y, w) => `make${at}(${y}, ${w})()`;
    } else if (form < 0.7) {
      const fields = isTyped ? `  y${typed(number)};\n  w${typed(number)};\n` : "";
      text = `class C${at} {\n${fields}  constructor(${parameters}) {\n    this.y = y;\n    this.w = w;\n  }\n  run()${typed("string")} {\n  let { y, w } = this;\n  ${inside}\n  }\n}`;
      call = (y, w) => `new C${at}(${y}, ${w}).run()`;
    } else if (form < 0.76)
      text = `class M${at} {\n  y${typed("number")} = 0;\n  w${typed("number")} = 1;\n  run(i${typed("number")})${typed("any")} {\n    const y = this.y, w = this.w;\n    return ${formula()};\n  }\n}\nfunction ${name}(${parameters})${typed("string")} {\n  const m = new M${at}();\n  m.y = y;\n  m.w = w;\n  const o${typed("any[]")} = [];\n  for (let i = 0; i < 3; i++) o.push(m.run(i));\n  return o.map(show).join();\n}`;
    else if (form < 0.82) {
      text = `function* g${at}(${parameters})${typed("any")} {\n  ${before}\n  ${loop}\n  yield show(s) + t;\n  yield o.map(show).join();\n}`;
      call = (y, w) => `[...g${at}(${y}, ${w})].join(";")`;
    } else if (form < 0.87)
      text = `function ${name}(${parameters}, i${typed("number")} = 0)${typed("string")} {\n  const v = ${formula()};\n  return i >= 3 ? show(v) : show(v) + " " + ${name}(y, w, i + 1);\n}`;
    else if (form < 0.92) {
      text = `function ${name}(l${typed(pick(["number[]", "any", "Float64Array"]))})${typed("string")} {\n  let y${typed("any")} = l[0], w${typed("any")} = l[1];\n  ${inside}\n}`;
      call = (y, w) => pick([`${name}([${y}, ${w}]${cast})`, `${name}(new Float64Array([${y}, ${w}])${cast})`]);
    } else if (form < 0.96) {
      text = `const Y${at} = ${pairs[0]![0]}, W${at} = ${pairs[0]![1]};\nfunction ${name}()${typed("string")} {\n  let y = Y${at}, w = W${at};\n  ${inside}\n}`;
      call = () => `${name}()`;
    } else {
      text = `function ${name}(${parameters})${typed("string")} {\n  ${inside}\n}`;
      call = (y, w) => `${name}.apply(null, [${y}, ${w}]${cast})`;
    }
    const hidden = next();
    const hide = (number: string) => `hide(${number})`;
    const calls = pairs.map(([y, w]) => `say("${at}", () => ${hidden < 0.2 ? call(hide(y!), hide(w!)) : hidden < 0.32 ? call(hide(y!), w!) : hidden < 0.4 ? call(y!, hide(w!)) : call(y!, w!)});`); // prettier-ignore
    return {
      text,
      calls: next() < 0.25 ? [`for (let z = 0; z < ${pick([1, 3])}; z++) {\n  ${calls.join("\n  ")}\n}`] : calls,
    };
  }
  const functions = draws.several(4, writeFunction);
  const lines = [
    `const list${typed("any[]")} = [10, 20.5, 30, 40], view = new Int32Array([7, -8, 9, 2147483647]), f64 = new Float64Array(2), f32 = new Float32Array(1), v8 = new Int8Array(1), v16 = new Int16Array(1), v32 = new Int32Array(1), u32 = new Uint32Array(1), c8 = new Uint8ClampedArray(1);`,
    `const show = (v${typed("any")})${typed("string")} => (Object.is(v, -0) ? "-0" : String(v));`,
    `const hide = (v${typed("number")})${typed("number")} => (process.argv.length > 99 ? 0 : Number(JSON.parse(JSON.stringify(show(v)))));`,
    `const lines${typed("string[]")} = [];`,
    `const say = (name${typed("string")}, ask${typed("() => any")}) => {\n  let v${typed("any")};\n  try {\n    v = ask();\n  } catch (error${typed("any")}) {\n    v = "!" + error.name;\n  }\n  lines.push(name + " " + v);\n};`,
    ...functions.map(one => one.text),
    ...functions.flatMap(one => one.calls),
    'console.log(lines.join("\\n"));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${functions.length}-functions.${isTyped ? "ts" : "mjs"}`, text: lines.join("\n") + "\n" };
}

writePrograms(8_000_000, write);
