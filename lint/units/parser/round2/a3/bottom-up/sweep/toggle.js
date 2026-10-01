const t = new Bun.Transpiler({ loader: "ts" });
const run = () => { try { return JSON.stringify(t.transformSync("let x: (a: ) => void;\n")); } catch (e) { return "ERR " + (e.errors ?? [e]).map(x => x.message); } };
console.log("before:", run());
process.env.BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT = "1";
console.log("after set:", run());
delete process.env.BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT;
console.log("after delete:", run());
