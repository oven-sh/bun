const path = require("path");
const { Linter } = require(path.join(__dirname, "eslint-pin/lib/linter"));
const linter = new Linter({ configType: "flat" });
const rule = process.argv[2];
let files = 0, fatal = 0, withReports = 0, reports = 0;
for (const f of process.argv.slice(3)) {
  for (const code of JSON.parse(require("fs").readFileSync(f, "utf8"))) {
    files++;
    const m = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { [rule]: "error" } }]);
    if (m.some(x => x.fatal)) { fatal++; continue; }
    if (m.length) withReports++;
    reports += m.length;
  }
}
console.log({ rule, files, fatal, withReports, reports });
