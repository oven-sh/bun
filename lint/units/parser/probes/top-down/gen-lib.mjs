// Shared by the gen-NN.mjs files: writes one input file of the runner from lists of sources.
import fs from "node:fs";
import path from "node:path";

// sections: [{ prefix, kind, items }]. An item is a source, or [source, twin].
export function writeGroup(fileName, header, sections) {
  const out = [];
  const counts = {};
  for (const s of sections) {
    let n = 0;
    const seen = new Set();
    for (const item of s.items) {
      const [src, twin] = Array.isArray(item) ? item : [item, null];
      if (seen.has(src)) continue;
      if (/^(=== |--- twin$)/m.test(src)) throw new Error(`${fileName}: ${s.prefix}: reserved line in: ${src}`);
      seen.add(src);
      n++;
      const id = `${s.prefix}.${String(n).padStart(3, "0")}`;
      out.push(`=== ${s.kind} ${id}\n${src}` + (twin !== null ? `\n--- twin\n${twin}` : ""));
      counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    }
  }
  const file = path.join(import.meta.dirname, "inputs", fileName);
  fs.writeFileSync(file, `# ${header}\n# Written by a gen-NN.mjs file: change that file, not this one.\n` + out.join("\n") + "\n");
  console.log(file, counts);
}

// Every source of `list` with `${hole}` replaced by each of `values`.
export function each(values, make) {
  return values.map(make);
}
