// Classifies every line of the first section of every error baseline with the grammar of the plain format.
import { readdirSync, readFileSync } from "node:fs";

const dirs = process.argv.slice(2);
const located = /^(.*?)\((\d+|--),(\d+|--)\): (error|warning|suggestion|message) ([A-Za-z]*)(-?\d+): (.*)$/;
const global = /^(error|warning|suggestion|message) ([A-Za-z]*)(-?\d+): (.*)$/;
const chain = /^((?:  )+)(\S.*)$/;

let files = 0, pretty = 0, plain = 0;
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
const odd: string[] = [];
const categories: Record<string, number> = {};
const prefixes: Record<string, number> = {};
let maxDepth = 0;
let noTerminator = 0;
for (const dir of dirs) {
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".errors.txt")) continue;
    files++;
    const text = readFileSync(dir + "/" + name, "latin1");
    if (text.includes("\u001b[")) { pretty++; continue; }
    plain++;
    const end = text.indexOf("\r\n\r\n\r\n");
    if (end < 0) { bump("no-section-end"); odd.push(name + ": no section end"); continue; }
    const section = text.slice(0, end + 2);
    if (!section.endsWith("\r\n")) noTerminator++;
    const lines = section.slice(0, -2).split("\r\n");
    let previous: "none" | "head" | "chain" = "none";
    let previousDepth = 0;
    for (const line of lines) {
      let m: RegExpExecArray | null;
      if (line.includes("\n") || line.includes("\r")) { bump("bare-cr-or-lf-in-line"); odd.push(name + ": bare CR or LF: " + JSON.stringify(line.slice(0, 200))); }
      if ((m = chain.exec(line)) !== null) {
        const depth = m[1].length / 2;
        maxDepth = Math.max(maxDepth, depth);
        if (previous === "none") { bump("chain-without-head"); odd.push(name + ": chain without head: " + line.slice(0, 120)); }
        else if (depth > previousDepth + 1) { bump("chain-depth-jump"); if (odd.length < 80) odd.push(name + ": depth jump " + previousDepth + "->" + depth + ": " + line.slice(0, 120)); }
        bump("chain");
        previous = "chain";
        previousDepth = depth;
        // a chain line that would also parse as a head
        continue;
      }
      if ((m = located.exec(line)) !== null) {
        bump("located");
        categories[m[4]] = (categories[m[4]] ?? 0) + 1;
        prefixes[m[5]] = (prefixes[m[5]] ?? 0) + 1;
        if (m[2] === "--") bump("located-lib-dashes");
        if (m[7] === "") bump("located-empty-message");
        previous = "head"; previousDepth = 0;
        continue;
      }
      if ((m = global.exec(line)) !== null) {
        bump("global");
        categories[m[1]] = (categories[m[1]] ?? 0) + 1;
        prefixes[m[2]] = (prefixes[m[2]] ?? 0) + 1;
        previous = "head"; previousDepth = 0;
        continue;
      }
      bump("unmatched");
      if (odd.length < 200) odd.push(name + ": unmatched: " + JSON.stringify(line.slice(0, 200)));
    }
  }
}
console.log(JSON.stringify({ dirs, files, pretty, plain, counts, categories, prefixes, maxDepth, noTerminator }, null, 1));
console.log(odd.slice(0, 120).join("\n"));
