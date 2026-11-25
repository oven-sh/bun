// Reference: bun build --compile
// The text that a message quotes is held to the executable that `bun build --compile` makes without --aot, not to `bun run`.
// `o[key]++` on undefined: where JSC's parser finds a text or a number in the brackets the update fails like a read, and else with a message of its own.
// What it finds there is what the build has printed: a bundle that does not minify syntax prints a sum of texts, a constant and a template as they are written.
const say = (label, run) => { try { run(); console.log(label + ": no throw"); } catch (error) { console.log(label + ":", error.message); } };
const moduleKey = "x";
let o;
say("name in brackets", () => o["x"]++);
say("template", () => o[`x`]++);
say("sum of texts", () => o["x" + ""]++);
say("constant of the module", () => o[moduleKey]++);
say("constant and a text", () => o[moduleKey + ""]++);
say("joined template", () => o[`${moduleKey}`]++);
say("number", () => o[5]++);
say("sum of numbers", () => o[1 + 2]++);
say("not a number", () => o[0 / 0]--);
say("local constant", () => { const k = "x"; return o[k]++; });
say("add", () => (o[moduleKey + ""] += 1));
say("nullish", () => (o[moduleKey + ""] ??= 1));
say("in front", () => ++o[moduleKey + ""]);
say("comma", () => o[(0, "a")]++);
say("read", () => o[moduleKey + ""]);
say("store", () => (o[moduleKey + ""] = 1));
