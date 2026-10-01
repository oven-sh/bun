// Stand-in for a binary that has the two variables of proposal (d): reads the options, writes the report, prints the plain form.
import { writeFileSync } from "node:fs";
const raw = process.env.BUN_INTERNAL_LINT_OPTIONS;
let options: any;
if (raw !== undefined) {
  try {
    options = JSON.parse(raw);
  } catch {
    process.stderr.write("error: BUN_INTERNAL_LINT_OPTIONS is not JSON\n");
    process.exit(1);
  }
  for (const name of Object.keys(options.compilerOptions ?? {})) {
    if (name.startsWith("noSuch")) {
      process.stderr.write(`error: unknown compiler option '${name}'\n`);
      process.exit(1);
    }
  }
}
const file = process.argv[process.argv.length - 1];
const diagnostics = [
  { category: "error", code: 2322, messageText: "Type 'string' is not assignable to type 'number'.", location: { file, start: 6, length: 1, line: 1, character: 7 }, relatedInformation: [] },
];
process.stderr.write(`${file}(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n`);
const out = process.env.BUN_INTERNAL_LINT_REPORT;
if (out) writeFileSync(out, JSON.stringify({ checked: true, options, diagnostics, rules: [], standIns: [], internal: [] }));
process.exit(2);
