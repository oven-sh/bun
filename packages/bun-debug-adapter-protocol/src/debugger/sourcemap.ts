import { posix } from "node:path";

export type LocationRequest = {
  line?: number;
  column?: number;
  url?: string;
};

export type Location = {
  line: number; // 0-based
  column: number; // 0-based
} & (
  | {
      verified: true;
    }
  | {
      verified?: false;
      message?: string;
    }
);

export interface SourceMap {
  /**
   * Converts a location in the original source to a location in the generated source.
   * @param request A request
   */
  generatedLocation(request: LocationRequest): Location;
  /**
   * Converts a location in the generated source to a location in the original source.
   * @param request A request
   */
  originalLocation(request: LocationRequest): Location;
}

type Position = {
  line: number;
  column: number;
};

/**
 * The segments of the `mappings` of a source map, in generated order. Lines and columns are 0-based.
 *
 * Bun's printer starts every generated line that does not begin with a segment with a copy of the
 * segment before it. A copy is not a token: it says where the previous token's code continues.
 */
type Segments = {
  generatedLine: Int32Array;
  generatedColumn: Int32Array;
  /** -1 when the segment maps to no source. */
  source: Int32Array;
  originalLine: Int32Array;
  originalColumn: Int32Array;
  /** The segments by source, original line, original column, generated column, generated line. */
  byOriginal: Int32Array;
};

class ActualSourceMap implements SourceMap {
  /** Most scripts are never looked up, so the mappings are decoded on the first lookup. */
  #segments: Segments | string;
  #sources: string[];

  constructor(sourceMap: { version: unknown; sources: unknown[]; sourceRoot?: string | null; mappings: unknown }) {
    const { version, sources, sourceRoot, mappings } = sourceMap;
    if (version != 3 || typeof mappings !== "string") {
      throw new Error("Unsupported source map");
    }
    this.#segments = mappings;
    this.#sources = sources.map(source => sourceName(sourceRoot, String(source)));
  }

  #getSegments(): Segments {
    if (typeof this.#segments === "string") {
      this.#segments = decodeMappings(this.#segments);
    }
    return this.#segments;
  }

  #getSource(url?: string): number {
    const sources = this.#sources;
    if (sources.length === 1 || !url) {
      return 0;
    }
    return sources.findIndex(source => url.endsWith(source));
  }

  generatedLocation(request: LocationRequest): Location {
    const { line, column, url } = request;
    return toLocation(request, () =>
      this.#generatedPosition(this.#getSource(url), lineToLine(line), columnToColumn(column)),
    );
  }

  #generatedPosition(source: number, line: number, column: number): Position | undefined {
    if (source === -1) {
      return undefined;
    }

    const segments = this.#getSegments();
    const { generatedLine, originalLine, byOriginal } = segments;
    const isInSource = (entry: number) =>
      entry >= 0 && entry < byOriginal.length && segments.source[byOriginal[entry]] === source;
    const isInLine = (entry: number) => isInSource(entry) && originalLine[byOriginal[entry]] === line;
    const position = (segment: number) => ({ line: generatedLine[segment], column: segments.generatedColumn[segment] });

    // `next` is the first entry after the column. When the line has a token at the column, the
    // first place where the printer printed that token answers.
    const next = lowerBound(segments, source, line, column + 1);
    if (isInLine(next - 1)) {
      return position(firstSegment(segments, firstEntry(segments, next - 1)));
    }

    // The column is before the first token of the line, or the line has no token: it is blank, a
    // comment, or a closing brace. The code before it ends at the first entry of the token before
    // it: its copy at the start of the next generated line, when there is one.
    const before = isInSource(next - 1) ? byOriginal[firstEntry(segments, next - 1)] : -1;
    if (!isInLine(next)) {
      return before === -1 ? undefined : position(before);
    }

    // The code of the line starts in the first run of its tokens that the printer printed after
    // that end. A token can also be printed before it, or long after it: a decorator, the closing
    // tag of a JSX element. When the printer moved the whole line up, its first run answers.
    let start = firstSegmentAfter(segments, next, before);
    if (start === -1) {
      start = firstSegmentAfter(segments, next, -1);
    }
    start = startOfRun(segments, start);

    // JSC moves a breakpoint to the first place at or after the request where it can pause
    // (`breakpointLocationForOffset`), and the code of the line can start before its first token:
    // a closing brace or `export` has no token. So when the code before the line ends in the
    // generated line of `start`, answer with that end. Otherwise, with the start of that line.
    if (before !== -1 && before < start && generatedLine[before] === generatedLine[start]) {
      return position(before);
    }
    return { line: generatedLine[start], column: 0 };
  }

  originalLocation(request: LocationRequest): Location {
    const { line, column } = request;
    return toLocation(request, () => this.#originalPosition(lineToLine(line), columnToColumn(column)));
  }

  #originalPosition(line: number, column: number): Position | undefined {
    const segments = this.#getSegments();
    const { generatedLine, generatedColumn, source, originalLine, originalColumn } = segments;

    // `next` is the first segment after the position, `at` the one before it.
    let next = 0;
    let high = generatedLine.length;
    while (next < high) {
      const middle = (next + high) >>> 1;
      if ((generatedLine[middle] - line || generatedColumn[middle] - column) <= 0) {
        next = middle + 1;
      } else {
        high = middle;
      }
    }
    const at = next - 1;

    let token = at;
    const isBeforeFirstToken = at === -1 || generatedLine[at] !== line || isCopy(segments, at);
    if (isBeforeFirstToken && next < generatedLine.length && generatedLine[next] === line) {
      // The first token of the line answers for the code before it, unless the printer printed
      // that token again for code of a later line: `})(X ||= {})` after an enum maps to the name
      // in the enum's first line. A token that is printed for the first time is not such a token,
      // also when it maps back: the first statement after a class that the runtime moved up.
      const isPrintedAgain =
        at !== -1 &&
        source[next] === source[at] &&
        (originalLine[next] - originalLine[at] || originalColumn[next] - originalColumn[at]) < 0 &&
        firstSegment(segments, lowerBound(segments, source[next], originalLine[next], originalColumn[next])) < next;
      if (!isPrintedAgain) {
        token = next;
      }
    }

    if (token === -1 || source[token] === -1) {
      return undefined;
    }
    return { line: originalLine[token], column: originalColumn[token] };
  }
}

class NoopSourceMap implements SourceMap {
  generatedLocation(request: LocationRequest): Location {
    const { line, column } = request;
    return {
      line: lineToLine(line),
      column: columnToColumn(column),
      verified: true,
    };
  }

  originalLocation(request: LocationRequest): Location {
    const { line, column } = request;
    return {
      line: lineToLine(line),
      column: columnToColumn(column),
      verified: true,
    };
  }
}

const defaultSourceMap = new NoopSourceMap();

export function SourceMap(url?: string): SourceMap {
  if (!url) {
    return defaultSourceMap;
  }
  if (!url.startsWith("data:")) {
    const match = url.match(/\/\/[#@]\s*sourceMappingURL=(.*)$/m);
    if (!match) {
      return defaultSourceMap;
    }
    const [_, sourceMapUrl] = match;
    url = sourceMapUrl;
  }
  try {
    const [_, base64] = url.split(",", 2);
    const decoded = Buffer.from(base64, "base64url").toString("utf8");
    const schema = JSON.parse(decoded);
    return new ActualSourceMap(schema);
  } catch (error) {
    console.warn("Failed to parse source map URL", url);
  }
  return defaultSourceMap;
}

function toLocation(request: LocationRequest, lookup: () => Position | undefined): Location {
  const { line, column } = request;

  let position: Position | undefined;
  try {
    position = lookup();
  } catch (error) {
    return {
      line: lineToLine(line),
      column: columnToColumn(column),
      verified: false,
      message: unknownToError(error),
    };
  }

  if (!position) {
    return {
      line: lineToLine(line),
      column: columnToColumn(column),
      verified: false,
    };
  }

  return {
    ...position,
    verified: true,
  };
}

/** The first entry of `byOriginal` that is at or after an original position. */
function lowerBound(segments: Segments, source: number, line: number, column: number): number {
  const { byOriginal } = segments;
  let low = 0;
  let high = byOriginal.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const segment = byOriginal[middle];
    const order =
      segments.source[segment] - source ||
      segments.originalLine[segment] - line ||
      segments.originalColumn[segment] - column;
    if (order < 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function isSameOriginal(segments: Segments, a: number, b: number): boolean {
  return (
    segments.source[a] === segments.source[b] &&
    segments.originalLine[a] === segments.originalLine[b] &&
    segments.originalColumn[a] === segments.originalColumn[b]
  );
}

/** The first entry of `byOriginal` with the original position of `entry`. */
function firstEntry(segments: Segments, entry: number): number {
  const { byOriginal } = segments;
  while (entry > 0 && isSameOriginal(segments, byOriginal[entry - 1], byOriginal[entry])) {
    entry--;
  }
  return entry;
}

/**
 * The first segment, in generated order, of the token whose entries of `byOriginal` start at
 * `entry`. The printer can print one token several times (a parameter property is also a class
 * field and an assignment). It is never a copy: a copy is after the segment that it copies.
 */
function firstSegment(segments: Segments, entry: number): number {
  const { byOriginal } = segments;
  let first = byOriginal[entry];
  for (let i = entry + 1; i < byOriginal.length && isSameOriginal(segments, byOriginal[i], first); i++) {
    if (byOriginal[i] < first) {
      first = byOriginal[i];
    }
  }
  return first;
}

/**
 * The first segment after the segment `before`, in generated order, of the tokens of one original
 * line from `entry` of `byOriginal` on. -1 when the printer printed none of them after `before`.
 */
function firstSegmentAfter(segments: Segments, entry: number, before: number): number {
  const { byOriginal, source, originalLine } = segments;
  const first = byOriginal[entry];
  let found = -1;
  for (let i = entry; i < byOriginal.length; i++) {
    const segment = byOriginal[i];
    if (source[segment] !== source[first] || originalLine[segment] !== originalLine[first]) {
      break;
    }
    if (segment > before && (found === -1 || segment < found)) {
      found = segment;
    }
  }
  return found;
}

/**
 * Where the code starts in the run of segments of one original line that begins at `segment`: at
 * the start of the run, unless the run prints the token at its start again. A parameter property
 * is a class field first, and JSC does not enter the constructor from the line of the field. Then
 * it is the first print of the token that is first in the original line.
 */
function startOfRun(segments: Segments, segment: number): number {
  const { source, originalLine, originalColumn } = segments;
  let first = segment;
  let isPrintedAgain = false;
  for (let i = segment + 1; i < source.length; i++) {
    if (source[i] !== source[segment] || originalLine[i] !== originalLine[segment]) {
      break;
    }
    if (originalColumn[i] < originalColumn[first]) {
      first = i;
    }
    isPrintedAgain ||= originalColumn[i] === originalColumn[segment] && !isCopy(segments, i);
  }
  return isPrintedAgain ? first : segment;
}

/** A segment that starts a generated line with the original position of the segment before it. */
function isCopy(segments: Segments, segment: number): boolean {
  const { generatedLine } = segments;
  const previous = segment - 1;
  return (
    previous >= 0 &&
    segments.generatedColumn[segment] === 0 &&
    generatedLine[previous] < generatedLine[segment] &&
    segments.source[segment] !== -1 &&
    isSameOriginal(segments, previous, segment)
  );
}

const base64Digits = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  base64Digits["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charCodeAt(i)] = i;
}

const comma = 44;
const semicolon = 59;

/** https://tc39.es/ecma426/#sec-mappings */
function decodeMappings(mappings: string): Segments {
  let capacity = 1;
  for (let i = 0; i < mappings.length; i++) {
    const char = mappings.charCodeAt(i);
    if (char === comma || char === semicolon) {
      capacity++;
    }
  }

  const segments: Segments = {
    generatedLine: new Int32Array(capacity),
    generatedColumn: new Int32Array(capacity),
    source: new Int32Array(capacity),
    originalLine: new Int32Array(capacity),
    originalColumn: new Int32Array(capacity),
    byOriginal: new Int32Array(0),
  };
  let count = 0;
  let sorted = true;

  let index = 0;
  const isSeparator = () => {
    const char = mappings.charCodeAt(index);
    return char === comma || char === semicolon || index >= mappings.length;
  };
  const readNumber = () => {
    let value = 0;
    let shift = 0;
    let digit: number;
    do {
      digit = base64Digits[mappings.charCodeAt(index++)] ?? -1;
      if (digit === -1) {
        throw new Error("Invalid mappings in source map");
      }
      value += (digit & 31) * 2 ** shift;
      shift += 5;
    } while (digit & 32);
    return value % 2 ? -(value - 1) / 2 : value / 2;
  };

  let generatedLine = 0;
  let generatedColumn = 0;
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  while (index < mappings.length) {
    const char = mappings.charCodeAt(index);
    if (char === semicolon) {
      generatedLine++;
      generatedColumn = 0;
      index++;
      continue;
    }
    if (char === comma) {
      index++;
      continue;
    }

    const previousColumn = generatedColumn;
    generatedColumn += readNumber();
    if (generatedColumn < previousColumn) {
      sorted = false;
    }
    const hasSource = !isSeparator();
    if (hasSource) {
      source += readNumber();
      originalLine += readNumber();
      originalColumn += readNumber();
      // The name, which a location does not need.
      while (!isSeparator()) {
        readNumber();
      }
    }

    segments.generatedLine[count] = generatedLine;
    segments.generatedColumn[count] = generatedColumn;
    segments.source[count] = hasSource ? source : -1;
    segments.originalLine[count] = originalLine;
    segments.originalColumn[count] = originalColumn;
    count++;
  }

  const inOrder = (compare: (a: number, b: number) => number) => {
    const order = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      order[i] = i;
    }
    return order.sort(compare);
  };
  const generatedOrder = sorted
    ? undefined
    : inOrder(
        (a, b) =>
          segments.generatedLine[a] - segments.generatedLine[b] ||
          segments.generatedColumn[a] - segments.generatedColumn[b] ||
          a - b,
      );
  for (const key of ["generatedLine", "generatedColumn", "source", "originalLine", "originalColumn"] as const) {
    const values = segments[key].subarray(0, count);
    segments[key] = generatedOrder ? generatedOrder.map(i => values[i]) : values;
  }
  segments.byOriginal = inOrder(
    (a, b) =>
      segments.source[a] - segments.source[b] ||
      segments.originalLine[a] - segments.originalLine[b] ||
      segments.originalColumn[a] - segments.originalColumn[b] ||
      segments.generatedColumn[a] - segments.generatedColumn[b] ||
      segments.generatedLine[a] - segments.generatedLine[b],
  );
  return segments;
}

/** The scheme and the host of a URL. A URL can be without a scheme: `//host/path`. */
const urlOrigin = /^(?:[a-z][a-z\d+.-]*:)?\/\/[^/]*/i;

/** Removes `.`, `dir/..` and a second `/` from a path, or from the path of a URL. */
function normalize(name: string): string {
  const origin = name.match(urlOrigin)?.[0] ?? "";
  const path = name.slice(origin.length);
  return origin && !path ? origin : origin + posix.normalize(path);
}

/**
 * The name of a source, as source-map-js makes it. The `sourceRoot` of the map is prepended,
 * unless both are absolute (a path from `/`, or a URL) and the source is in the root, or in a
 * folder above the root. `/` alone is not such a folder. One name is not as in source-map-js:
 * a URL of another host stays as it is, where source-map-js puts the root in front of it.
 */
function sourceName(sourceRoot: string | null | undefined, source: string): string {
  source = normalize(source);
  if (!sourceRoot) {
    return source;
  }

  const root = normalize(sourceRoot);
  const isAbsolute = (name: string) => name.startsWith("/") || urlOrigin.test(name);
  if (isAbsolute(root) && isAbsolute(source)) {
    let folder = root.replace(/\/$/, "");
    do {
      if (source.startsWith(`${folder}/`)) {
        return source;
      }
      folder = folder.slice(0, Math.max(folder.lastIndexOf("/"), 0));
    } while (folder);
  }
  return normalize(root.endsWith("/") || source.startsWith("/") ? root + source : `${root}/${source}`);
}

function lineToLine(line?: number): number {
  return numberIsValid(line) ? line : 0;
}

function columnToColumn(column?: number): number {
  return numberIsValid(column) ? column : 0;
}

function numberIsValid(number?: number): number is number {
  return typeof number === "number" && isFinite(number) && number >= 0;
}

function unknownToError(error: unknown): string {
  if (error instanceof Error) {
    const { message } = error;
    return message;
  }
  return String(error);
}
