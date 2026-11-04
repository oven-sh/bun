// The names that functions and classes of Bun's own modules have in the text that `bun run` evaluates. A bundler made that text, and
// it renames bindings. Its source map says which token of the output stands for which token of a source.

export interface SourceMap {
  mappings: string;
  sources: string[];
  sourcesContent: string[];
}

/** An identifier of the output that names a function or a class: its own name, or the variable that an anonymous one is stored to. */
export interface NamingIdentifier {
  /** An index of `sources` of the map. */
  source: number;
  /** Where the identifier starts in the text of the source. */
  index: number;
  written: string;
  name: string;
  isOwnName: boolean;
  wasOwnName: boolean;
}

const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function* decodeMappings(mappings: string) {
  let at = 0;
  const readNumber = () => {
    let value = 0;
    for (let shift = 0; ; shift += 5) {
      const digit = digits.indexOf(mappings[at++]);
      value |= (digit & 31) << shift;
      if (!(digit & 32)) return value & 1 ? -(value >> 1) : value >> 1;
    }
  };
  const isInSegment = () => at < mappings.length && mappings[at] !== "," && mappings[at] !== ";";
  let [line, column, source, sourceLine, sourceColumn] = [0, 0, 0, 0, 0];
  while (at < mappings.length) {
    if (mappings[at] === ";") {
      line++;
      column = 0;
      at++;
    } else if (mappings[at] === ",") {
      at++;
    } else {
      column += readNumber();
      if (!isInSegment()) continue;
      source += readNumber();
      sourceLine += readNumber();
      sourceColumn += readNumber();
      if (isInSegment()) readNumber();
      yield { line, column, source, sourceLine, sourceColumn };
    }
  }
}

const startOfAnonymousFunctionOrClass = String.raw`(?:(?:async\s+)?function\s*\*?\s*\(|class\s*(?:\{|extends\b)|(?:async\s*)?\(|(?:async\s+)?[\w$]+\s*=>)`;
const storeOfAnonymousFunctionOrClass = new RegExp(
  String.raw`\s*(?:\|\||&&|\?\?)?=\s*` + startOfAnonymousFunctionOrClass,
  "y",
);

export class Text {
  #lineStarts = [0];
  constructor(readonly text: string) {
    for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) this.#lineStarts.push(at + 1);
  }

  indexOf(line: number, column: number): number {
    return this.#lineStarts[line] + column;
  }

  identifierAt(index: number): string | undefined {
    if (index > 0 && /[\w$]/.test(this.text[index - 1])) return undefined;
    const identifier = /[A-Za-z_$][\w$]*/y;
    identifier.lastIndex = index;
    return identifier.exec(this.text)?.[0];
  }

  isOwnName(index: number): boolean {
    return /(?<![\w$.])(?:function\s*\*?|class)\s*$/.test(this.text.slice(Math.max(0, index - 40), index));
  }

  isStoredAnonymousFunctionOrClass(end: number): boolean {
    storeOfAnonymousFunctionOrClass.lastIndex = end;
    return storeOfAnonymousFunctionOrClass.test(this.text);
  }
}

export function findNamingIdentifiers(output: string, map: SourceMap): NamingIdentifier[] {
  const made = new Text(output);
  const sources = map.sourcesContent.map(text => new Text(text));
  const found = new Map<string, NamingIdentifier>();
  for (const mapping of decodeMappings(map.mappings)) {
    const source = sources[mapping.source];
    const index = source.indexOf(mapping.sourceLine, mapping.sourceColumn);
    const madeIndex = made.indexOf(mapping.line, mapping.column);
    const written = source.identifierAt(index);
    const name = made.identifierAt(madeIndex);
    if (written === undefined || name === undefined) continue;
    const isOwnName = made.isOwnName(madeIndex);
    if (!isOwnName && !made.isStoredAnonymousFunctionOrClass(madeIndex + name.length)) continue;
    const key = `${mapping.source} ${index}`;
    const other = found.get(key);
    if (other !== undefined && other.name !== name) {
      throw new Error(
        `${map.sources[mapping.source]}:${mapping.sourceLine + 1}: the bundle names two functions after ${written}: ${other.name} and ${name}`,
      );
    }
    found.set(key, { source: mapping.source, index, written, name, isOwnName, wasOwnName: source.isOwnName(index) });
  }
  return [...found.values()].sort((a, b) => a.source - b.source || a.index - b.index);
}

export interface Word {
  text: string;
  index: number;
}

function listWords(text: string): Word[] {
  return [...text.matchAll(/[\w$]+/g)].map(match => ({ text: match[0], index: match.index }));
}

/**
 * `changed` is `original` with pieces replaced, moved to the front or left out. Answers, for the index of a word of `changed`, the
 * index of the same word in `original`. Two words are the same if `spell` answers the same for both. `noteReplaced` is told the
 * words of `original` that have none, and the words of `changed` in their place.
 */
export function alignWords(
  original: string,
  changed: string,
  spell = (word: string) => word,
  noteReplaced?: (old: Word[], replacement: Word[]) => void,
): Map<number, number> {
  const [writtenA, writtenB] = [listWords(original), listWords(changed)];
  const spelled = (words: Word[]) => words.map(word => ({ ...word, text: spell(word.text) }));
  const [a, b] = [spelled(writtenA), spelled(writtenB)];
  const run = 4;
  const continuesAlike = (i: number, j: number) => {
    for (let k = 0; k < run; k++) {
      if (i + k >= a.length || j + k >= b.length) return i + k >= a.length && j + k >= b.length;
      if (a[i + k].text !== b[j + k].text) return false;
    }
    return true;
  };
  const aligned = new Map<number, number>();
  let [i, j] = [0, 0];
  while (i < a.length && j < b.length) {
    if (a[i].text === b[j].text) {
      aligned.set(b[j++].index, a[i++].index);
      continue;
    }
    const limit = a.length - i + (b.length - j);
    search: for (let distance = 1; ; distance++) {
      if (distance > limit) return aligned;
      for (let skipped = 0; skipped <= distance; skipped++) {
        if (!continuesAlike(i + skipped, j + distance - skipped)) continue;
        noteReplaced?.(writtenA.slice(i, i + skipped), writtenB.slice(j, j + distance - skipped));
        i += skipped;
        j += distance - skipped;
        break search;
      }
    }
  }
  return aligned;
}

/** A line of the manifest of the sources. `index` is where the identifier starts in `text`, the text of `file`. No name: the function has none. */
export function formatBundledName(
  file: string,
  text: string,
  index: number,
  name: string | undefined,
  isOwnName: boolean,
) {
  return `name\t${file}\t${Buffer.byteLength(text.slice(0, index))}\t${name ?? "-"}\t${isOwnName ? "own" : "variable"}`;
}

/** The lines of the identifiers that the output does not have as `file` writes them. */
export function listBundledNames(file: string, text: string, identifiers: NamingIdentifier[]): string[] {
  return identifiers
    .filter(({ written, name, isOwnName, wasOwnName }) => name !== written || isOwnName !== wasOwnName)
    .map(({ index, name, isOwnName }) => formatBundledName(file, text, index, name, isOwnName));
}

/** The same for a module of src/js, which the bundler is not given as it is written: what it was given is in the map. */
export function listBundledNamesOfModule(file: string, written: string, output: string, map: SourceMap): string[] {
  if (map.sources.length !== 1) throw new Error(`${file}: the bundle has the text of ${map.sources.length} files`);
  const aligned = alignWords(written, map.sourcesContent[0]);
  const identifiers = findNamingIdentifiers(output, map);
  const inFile = identifiers.flatMap(identifier => {
    const index = aligned.get(identifier.index);
    return index === undefined ? [] : [{ ...identifier, index }];
  });
  const lines = listBundledNames(file, written, inFile);
  // `export default` is given to the bundler as a store to the variable `$`, or as an operand.
  const defaultExport = new RegExp(String.raw`^export\s+default\s+(?=${startOfAnonymousFunctionOrClass})`, "m").exec(
    written,
  );
  if (defaultExport) {
    const variable = identifiers.find(({ index, written }) => written === "$" && !aligned.has(index));
    lines.push(formatBundledName(file, written, defaultExport.index, variable?.name, false));
  }
  return lines;
}
