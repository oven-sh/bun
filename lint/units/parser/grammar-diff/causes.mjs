// The intended changes of the branch, one entry per change. diff.mjs gives a differing record to the
// first entry whose match(d) is true. d = { src, ctx, t, prod, mut, api, cls, base, next, tsc }:
//   cls   "R>A" | "A>A" | "R>R" | "A>R" | ...
//   base, next   ["o", text] | ["e", [[message, line, column], ...]] | ["s", scan] | ["i", imports]
//   tsc   the oracle record of the source: { ts: [diagnostics], tsx: [...], meta?, metaLoose? } or null
// Helpers for the predicates are below. An empty list makes every differing record "unexplained".

// True when tsc parses the source without a diagnostic in the dialect of the api.
export const tscParses = d => d.tsc !== null && (d.api.includes(".tsx.") ? d.tsc.tsx : d.tsc.ts).length === 0;

// The metadata calls of a Bun output, as [key, value] pairs in emit order.
export function bunMetadataOf(text) {
  const out = [];
  const re = /__legacyMetadataTS\w*\("(design:\w+)", /g;
  for (let m; (m = re.exec(text)); ) {
    let depth = 0;
    let i = re.lastIndex;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    out.push([m[1], text.slice(re.lastIndex, i).replace(/\s+/g, " ").trim()]);
  }
  return out;
}

// Both sides accept and the outputs are equal once the metadata values are blanked.
export function onlyMetadataDiffers(d) {
  if (d.cls !== "A>A" || d.base[0] !== "o" || d.next[0] !== "o") return false;
  const blank = text => {
    let out = text;
    for (const [, value] of bunMetadataOf(text)) out = out.replace(value, "<metadata>");
    return out;
  };
  return blank(d.base[1]) === blank(d.next[1]);
}

export default [
  // { id: "valid-ts-accepted", title: "input that tsc parses is accepted", match: d => d.cls === "R>A" && tscParses(d) },
];
