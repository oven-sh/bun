const { run } = require("./oracle.cjs");
const rule = process.argv[2];
const cases = JSON.parse(require("fs").readFileSync(process.argv[3], "utf8"));
for (const c of cases) {
  const code = typeof c === "string" ? c : c.code;
  const out = run(rule, code, typeof c === "string" ? {} : c);
  console.log(JSON.stringify(code) + "  =>  " + (out.length ? out.join("  |  ") : "(none)"));
}
