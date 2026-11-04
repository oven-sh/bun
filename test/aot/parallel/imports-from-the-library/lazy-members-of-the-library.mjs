import util, { format, inspect, promisify, styleText, parseArgs, deprecate, isDeepStrictEqual } from "node:util";
let text = "";
for (let i = 0; i < 3; i++) text += [format("%s:%j", i, { i }), inspect([i, "x"]), typeof promisify(cb => cb(null, i)), isDeepStrictEqual({ a: i }, { a: i }), typeof styleText, typeof parseArgs, typeof deprecate(() => i, "m")].join("|") + ";";
console.log(text, util.format === format, util.inspect === inspect);
