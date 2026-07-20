// Two-way position mapping for a transpiled script's source map (source
// map v3 `mappings` VLQ). The debugger protocol speaks JSC's compiled
// coordinates; Node clients speak original-source coordinates. Only the
// single-source case matters here (one file transpiled to itself).

const kBase64: Record<string, number> = {};
{
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) kBase64[alphabet[i]] = i;
}

// A decoded segment: generated (line, column) -> original (line, column).
// Kept as parallel typed arrays sorted by generated position (the encoding
// order), plus a permutation index sorted by original position.
export class ScriptSourceMap {
  #genLine: Int32Array;
  #genCol: Int32Array;
  #origLine: Int32Array;
  #origCol: Int32Array;
  // Segment indices ordered by (origLine, origCol, genLine, genCol).
  #byOriginal: Int32Array;

  constructor(
    genLine: Int32Array,
    genCol: Int32Array,
    origLine: Int32Array,
    origCol: Int32Array,
    byOriginal: Int32Array,
  ) {
    this.#genLine = genLine;
    this.#genCol = genCol;
    this.#origLine = origLine;
    this.#origCol = origCol;
    this.#byOriginal = byOriginal;
  }

  get size(): number {
    return this.#genLine.length;
  }

  // Compiled -> original: the segment with the greatest generated column
  // <= column on the same generated line. Segments never span generated
  // lines, so a line with no segments maps to nothing (as JSC/V8 do).
  originalPositionFor(line: number, column: number): { line: number; column: number } | undefined {
    const n = this.#genLine.length;
    if (n === 0) return undefined;
    let lo = 0;
    let hi = n - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const l = this.#genLine[mid];
      const c = this.#genCol[mid];
      if (l < line || (l === line && c <= column)) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0 || this.#genLine[found] !== line) return undefined;
    return { line: this.#origLine[found], column: this.#origCol[found] };
  }

  // Original -> compiled, V8-style breakpoint resolution: the earliest
  // generated position among segments on the requested original line, or
  // on the nearest following original line if that line has none.
  generatedPositionFor(line: number, column: number): { line: number; column: number } | undefined {
    const n = this.#byOriginal.length;
    if (n === 0) return undefined;
    // Lower bound on (origLine >= line) within the original-sorted permutation.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const seg = this.#byOriginal[mid];
      if (this.#origLine[seg] < line) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= n) return undefined;
    const targetLine = this.#origLine[this.#byOriginal[lo]];
    // Among segments on targetLine, pick the least generated position whose
    // original column is >= column; if none, the least generated position.
    let bestGenLine = -1;
    let bestGenCol = -1;
    let fallbackGenLine = -1;
    let fallbackGenCol = -1;
    for (let i = lo; i < n; i++) {
      const seg = this.#byOriginal[i];
      if (this.#origLine[seg] !== targetLine) break;
      const gl = this.#genLine[seg];
      const gc = this.#genCol[seg];
      if (fallbackGenLine < 0 || gl < fallbackGenLine || (gl === fallbackGenLine && gc < fallbackGenCol)) {
        fallbackGenLine = gl;
        fallbackGenCol = gc;
      }
      if (this.#origCol[seg] >= column) {
        if (bestGenLine < 0 || gl < bestGenLine || (gl === bestGenLine && gc < bestGenCol)) {
          bestGenLine = gl;
          bestGenCol = gc;
        }
      }
    }
    if (bestGenLine >= 0) return { line: bestGenLine, column: bestGenCol };
    if (fallbackGenLine >= 0) return { line: fallbackGenLine, column: fallbackGenCol };
    return undefined;
  }
}

// Decodes source map v3 `mappings` into a ScriptSourceMap. Segments without
// a source position (1-field segments) carry no original coordinate and are
// skipped. Returns undefined for an empty or malformed encoding.
export function createScriptSourceMap(mappings: string): ScriptSourceMap | undefined {
  if (typeof mappings !== "string" || mappings.length === 0) return undefined;

  let capacity = 64;
  let count = 0;
  let genLine = new Int32Array(capacity);
  let genCol = new Int32Array(capacity);
  let origLine = new Int32Array(capacity);
  let origCol = new Int32Array(capacity);

  const grow = () => {
    capacity *= 2;
    const nl = new Int32Array(capacity);
    const nc = new Int32Array(capacity);
    const ol = new Int32Array(capacity);
    const oc = new Int32Array(capacity);
    nl.set(genLine);
    nc.set(genCol);
    ol.set(origLine);
    oc.set(origCol);
    genLine = nl;
    genCol = nc;
    origLine = ol;
    origCol = oc;
  };

  let line = 0;
  let column = 0;
  let sourceLine = 0;
  let sourceCol = 0;
  let i = 0;
  const len = mappings.length;
  // Decode one VLQ starting at index i; sets vlqValue and returns the new index.
  let vlqValue = 0;
  const readVLQ = (start: number): number => {
    let result = 0;
    let shift = 0;
    let pos = start;
    for (;;) {
      if (pos >= len) return -1;
      const digit = kBase64[mappings[pos++]];
      if (digit === undefined) return -1;
      result += (digit & 31) << shift;
      if (digit & 32) {
        shift += 5;
        continue;
      }
      vlqValue = result & 1 ? -(result >>> 1) : result >>> 1;
      return pos;
    }
  };

  while (i < len) {
    const ch = mappings[i];
    if (ch === ";") {
      line++;
      column = 0;
      i++;
      continue;
    }
    if (ch === ",") {
      i++;
      continue;
    }
    // Field 1: generated column (relative within the line).
    i = readVLQ(i);
    if (i < 0) return undefined;
    column += vlqValue;
    let hasSource = false;
    if (i < len && mappings[i] !== "," && mappings[i] !== ";") {
      // Field 2: source index (ignored: single source).
      i = readVLQ(i);
      if (i < 0) return undefined;
      // Field 3: original line.
      i = readVLQ(i);
      if (i < 0) return undefined;
      sourceLine += vlqValue;
      // Field 4: original column.
      i = readVLQ(i);
      if (i < 0) return undefined;
      sourceCol += vlqValue;
      hasSource = true;
      // Field 5: name index (ignored).
      if (i < len && mappings[i] !== "," && mappings[i] !== ";") {
        i = readVLQ(i);
        if (i < 0) return undefined;
      }
    }
    if (!hasSource) continue;
    if (count === capacity) grow();
    genLine[count] = line;
    genCol[count] = column;
    origLine[count] = sourceLine;
    origCol[count] = sourceCol;
    count++;
  }

  if (count === 0) return undefined;

  const gl = genLine.subarray(0, count);
  const gc = genCol.subarray(0, count);
  const ol = origLine.subarray(0, count);
  const oc = origCol.subarray(0, count);

  const byOriginal = new Int32Array(count);
  for (let k = 0; k < count; k++) byOriginal[k] = k;
  byOriginal.sort((a, b) => ol[a] - ol[b] || oc[a] - oc[b] || gl[a] - gl[b] || gc[a] - gc[b]);

  return new ScriptSourceMap(gl, gc, ol, oc, byOriginal);
}

// Parses an inline `data:application/json;base64,` source map URL down to
// its `mappings` string.
export function mappingsFromDataURL(sourceMapURL: string): string | undefined {
  if (typeof sourceMapURL !== "string" || !sourceMapURL.startsWith("data:")) return undefined;
  const comma = sourceMapURL.indexOf(",");
  if (comma < 0) return undefined;
  const meta = sourceMapURL.slice(0, comma);
  const payload = sourceMapURL.slice(comma + 1);
  try {
    const json = meta.includes(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    const map = JSON.parse(json);
    return typeof map?.mappings === "string" ? map.mappings : undefined;
  } catch {
    return undefined;
  }
}
