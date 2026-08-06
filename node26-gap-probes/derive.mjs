// Re-derive "public APIs added in (24.3.0, 26.3.0]" from node's doc/api/*.md
// YAML changelog blocks: <!-- YAML\nadded: v26.1.0\n... -->  (added may be a list)
import { readdirSync, readFileSync } from "node:fs";

const DIR = "/workspace/node-v26.3.0/doc/api";
const LO = [24, 3, 0]; // exclusive
const HI = [26, 3, 0]; // inclusive

function parseV(s) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(s);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const entries = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith(".md")) continue;
  const text = readFileSync(`${DIR}/${f}`, "utf8");
  const lines = text.split("\n");
  // module-level flag mentions
  const fileFlags = [...new Set(text.match(/--[a-z][a-z0-9-]*(?:experimental|permission)[a-z0-9-]*|--experimental-[a-z0-9-]+|--permission\b/g) || [])];
  let curHeading = null;
  let curDepth = 0;
  let headingLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const hm = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (hm) {
      curHeading = hm[2].replace(/`/g, "").trim();
      curDepth = hm[1].length;
      headingLine = i;
      continue;
    }
    if (lines[i].trim() === "<!-- YAML" && i - headingLine <= 3 && curHeading) {
      // gather the YAML block
      let j = i + 1;
      const yaml = [];
      while (j < lines.length && !lines[j].includes("-->")) {
        yaml.push(lines[j]);
        j++;
      }
      // parse added:
      let added = [];
      for (let k = 0; k < yaml.length; k++) {
        const am = /^\s*added:\s*(.*)$/.exec(yaml[k]);
        if (am) {
          if (am[1].trim() && am[1].trim() !== "") {
            // inline: added: v26.1.0  or added: REPLACEME
            const v = parseV(am[1]);
            if (v) added.push(v);
            else if (am[1].includes("REPLACEME")) added.push([99, 0, 0]);
          } else {
            // list form
            let k2 = k + 1;
            while (k2 < yaml.length && /^\s*-\s*/.test(yaml[k2])) {
              const v = parseV(yaml[k2]);
              if (v) added.push(v);
              k2++;
            }
          }
          break;
        }
      }
      if (added.length === 0) continue;
      added.sort(cmp);
      const minAdded = added[0];
      if (cmp(minAdded, LO) > 0 && cmp(minAdded, HI) <= 0) {
        // stability + flags for the section (up to next heading of depth <= curDepth)
        let secEnd = lines.length;
        for (let k = headingLine + 1; k < lines.length; k++) {
          const hm2 = /^(#{1,6})\s+/.exec(lines[k]);
          if (hm2 && hm2[1].length <= curDepth) {
            secEnd = k;
            break;
          }
        }
        const sec = lines.slice(headingLine, secEnd).join("\n");
        const stab = /Stability:\s*([\d.]+)\s*-?\s*([^\n]*)/.exec(sec);
        const secFlags = [...new Set(sec.match(/--experimental-[a-z0-9-]+|--permission\b/g) || [])];
        entries.push({
          file: f,
          heading: curHeading,
          depth: curDepth,
          added: added.map((v) => v.join(".")),
          stability: stab ? `${stab[1]} ${stab[2].trim()}`.trim() : null,
          section_flags: secFlags,
          file_flags: fileFlags.filter((x) => x.startsWith("--")),
          line: headingLine + 1,
        });
      }
    }
  }
}
console.log(JSON.stringify(entries, null, 1));
console.error(`total in-window entries: ${entries.length}`);
