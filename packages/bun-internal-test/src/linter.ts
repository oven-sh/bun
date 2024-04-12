import { $ } from "bun";
import BANNED from "./banned.json";
import * as action from "@actions/core";

const IGNORED_FOLDERS = [
  // list of folders to ignore
  "windows-shim",
];

const ci = !!process.env["GITHUB_ACTIONS"];
process.chdir(require("path").join(import.meta.dir, "../../../"));
let bad = [];
let report = "";
const write = (text: string) => {
  process.stdout.write(text);
  report += text;
};
for (const [banned, suggestion] of Object.entries(BANNED)) {
  // Run git grep to find occurrences of std.debug.assert in .zig files
  let stdout = await $`git grep -n "${banned}" "src/**/**.zig"`.text();

  stdout = stdout.trim();
  if (stdout.length === 0) continue;

  let lines = stdout.split("\n");
  // Parse each line to extract filename and line number
  const matches = lines
    .filter(line => !IGNORED_FOLDERS.some(folder => line.includes(folder)))
    .map(line => {
      const [path, lineNumber, ...text] = line.split(":");
      return { path, lineNumber, banned, suggestion, text: text.join(":") };
    });
  // Check if we got any output
  // Split the output into lines
  if (matches.length === 0) continue;

  write(`Banned **'${banned}'** found in the following locations:` + "\n");
  matches.forEach(match => {
    write(`${match.path}:${match.lineNumber}: ${match.text.trim()}` + "\n");
  });
  bad = bad.concat(matches);
}

if (report.length === 0) {
  process.exit(0);
}

function link({ path, lineNumber, suggestion, banned }) {
  action.error(`Lint failure: ${banned} is banned, ${suggestion}`, {
    file: path,
    startLine: Number(lineNumber),
    endLine: Number(lineNumber),
  });
  return `[\`${path}:${lineNumber}\`](https://github.com/oven-sh/bun/blob/${process.env.GITHUB_SHA}/${path}#L${lineNumber})`;
}

if (ci) {
  if (report.length > 0) {
    action.setFailed(`${bad.length} lint failures`);
  }
  action.setOutput("count", bad.length);
  action.setOutput("text_output", bad.map(m => `- ${link(m)}: ${m.banned} is banned, ${m.suggestion}`).join("\n"));
  action.setOutput("json_output", JSON.stringify(bad));
  action.summary.addRaw(report);
  await action.summary.write();
}

process.exit(1);
