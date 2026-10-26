// Where the tokens of a module of src/js stand in the text that `bun run` evaluates. A stack trace shows lines and columns of that
// text. A bundler made it, and its source map says which token of the output stands for which token of what it was given.

import { alignWords, decodeMappings, type SourceMap, Text } from "./bundled-names";

/**
 * From byte `offset` of the module on, up to the next piece, the two texts are alike, line breaks included: the byte at `offset`
 * stands at `line` and `column` of the evaluated text, which count from 0.
 */
export interface Piece {
  offset: number;
  line: number;
  column: number;
}

const intrinsicPrefix = "__intrinsic__";
const spellWithoutPrefix = (word: string) =>
  word.startsWith(intrinsicPrefix) ? word.slice(intrinsicPrefix.length) : word.startsWith("$") ? word.slice(1) : word;

const isWordCharacter = (character: string | undefined) => character !== undefined && /[\w$]/.test(character);
const isSpace = (character: string | undefined) => character !== undefined && /\s/.test(character);

function wordAt(text: string, index: number): string {
  const word = /[\w$]+/y;
  word.lastIndex = index;
  return word.exec(text)?.[0] ?? "";
}

/** Index in `given`, the text that the bundler read, of a word > index of the word of `output` that stands for it. */
function findWordsOfOutput(given: string, output: string, map: SourceMap): Map<number, number> {
  const [from, to] = [new Text(given), new Text(output)];
  const found = new Map<number, number>();
  for (const mapping of decodeMappings(map.mappings)) {
    const index = from.indexOf(mapping.sourceLine, mapping.sourceColumn);
    const madeIndex = to.indexOf(mapping.line, mapping.column);
    if (!isWordCharacter(given[index]) || isWordCharacter(given[index - 1])) continue;
    if (!isWordCharacter(output[madeIndex]) || isWordCharacter(output[madeIndex - 1])) continue;
    // The `else` in front of a statement has the place of the statement, whose first word then has none of its own.
    const next = /[\w$]+\s+(?=[\w$])/y;
    next.lastIndex = madeIndex;
    const skipped = next.exec(output)?.[0].length ?? 0;
    if (
      skipped > 0 &&
      wordAt(output, madeIndex) !== wordAt(given, index) &&
      wordAt(output, madeIndex + skipped) === wordAt(given, index)
    ) {
      found.set(index, madeIndex + skipped);
      continue;
    }
    const other = found.get(index);
    if (other !== undefined && wordAt(output, other) === wordAt(given, index)) continue;
    if (other !== undefined && wordAt(output, madeIndex) !== wordAt(given, index)) continue;
    found.set(index, madeIndex);
  }
  return found;
}

/**
 * `written`: the module as the compiler reads it. `output`: what the bundler made, with `map`. `evaluated`: what `bun run` evaluates,
 * which is `output` with pieces replaced.
 */
export function findPositionsInEvaluatedText(
  written: string,
  output: string,
  map: SourceMap,
  evaluated: string,
): Piece[] {
  const given = map.sourcesContent[0];
  // A call of a function that only the library can name may stand for a call that is written otherwise.
  const calleesReplaced: [number, number][] = [];
  const writtenOfGiven = alignWords(written, given, spellWithoutPrefix, (old, replacement) => {
    const callee = replacement.findLast(word => word.text.startsWith(intrinsicPrefix));
    if (!callee) return;
    for (const word of old) {
      if (written[word.index + word.text.length] === "(") calleesReplaced.push([callee.index, word.index]);
    }
  });
  const outputOfGiven = findWordsOfOutput(given, output, map);
  const outputOfEvaluated = alignWords(output, evaluated, spellWithoutPrefix);
  const evaluatedOfOutput = new Map([...outputOfEvaluated].map(([to, from]) => [from, to]));

  // Index in `written` > index in `evaluated`.
  const places = new Map<number, number>();
  const ends = new Map<number, number>();
  for (const [givenIndex, writtenIndex] of [...writtenOfGiven, ...calleesReplaced]) {
    const outputIndex = outputOfGiven.get(givenIndex);
    let evaluatedIndex = outputIndex === undefined ? undefined : evaluatedOfOutput.get(outputIndex);
    if (evaluatedIndex === undefined) continue;
    const evaluatedEnd = evaluatedIndex + wordAt(evaluated, evaluatedIndex).length;
    if (evaluated[evaluatedIndex - 1] === "@") evaluatedIndex--;
    const writtenEnd = writtenIndex + wordAt(written, writtenIndex).length;
    places.set(writtenIndex, evaluatedIndex);
    // What stands between this word and the next one is alike in both texts but for spaces and for what only says a type.
    let [i, j] = [writtenEnd, evaluatedEnd];
    ends.set(i, j);
    for (;;) {
      while (isSpace(written[i])) i++;
      while (isSpace(evaluated[j])) j++;
      if (i >= written.length || isWordCharacter(written[i])) break;
      if (written[i] === "/" && (written[i + 1] === "/" || written[i + 1] === "*")) break;
      if (written[i] === evaluated[j]) {
        places.set(i++, j++);
        ends.set(i, j);
      } else if (written[i] === "!" && written[i + 1] !== "=") i++;
      else break;
    }
  }
  for (const [index, evaluatedIndex] of ends) if (!places.has(index)) places.set(index, evaluatedIndex);

  const lineStarts = [0];
  for (let at = evaluated.indexOf("\n"); at >= 0; at = evaluated.indexOf("\n", at + 1)) lineStarts.push(at + 1);
  const lineOf = (index: number) => {
    let [low, high] = [0, lineStarts.length];
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (lineStarts[middle] <= index) low = middle;
      else high = middle;
    }
    return low;
  };

  const pieces: Piece[] = [];
  let [bytes, counted, lastEvaluatedIndex] = [0, 0, 0];
  for (const [index, evaluatedIndex] of [...places].sort((a, b) => a[0] - b[0])) {
    const between = written.slice(counted, index);
    const isAlike = pieces.length > 0 && between === evaluated.slice(lastEvaluatedIndex, evaluatedIndex);
    bytes += Buffer.byteLength(between);
    [counted, lastEvaluatedIndex] = [index, evaluatedIndex];
    if (isAlike) continue;
    const line = lineOf(evaluatedIndex);
    pieces.push({ offset: bytes, line, column: evaluatedIndex - lineStarts[line] });
  }
  return pieces;
}

/** A line for the manifest of the sources. */
export function formatBundledPositions(file: string, written: string, pieces: Piece[]): string {
  return `positions\t${file}\t${Buffer.from(encodePieces(written, pieces)).toString("base64")}`;
}

/**
 * Numbers of 7 bits a byte, the lowest first; one that may be negative has its sign in its lowest bit. Each piece: how far its offset
 * is behind the last one's, then twice how many columns it stands further right than it would as a part of the last piece, or, on
 * another line than that, twice the difference of the lines plus one, and the column.
 */
export function encodePieces(written: string, pieces: Piece[]): Uint8Array {
  const text = Buffer.from(written);
  const bytes: number[] = [];
  const push = (value: number) => {
    for (; value >= 128; value = Math.floor(value / 128)) bytes.push((value % 128) | 128);
    bytes.push(value);
  };
  const signed = (value: number) => (value < 0 ? -value * 2 - 1 : value * 2);
  let last: Piece = { offset: 0, line: 0, column: 0 };
  for (const piece of pieces) {
    push(piece.offset - last.offset);
    let { line, column } = last;
    for (let at = last.offset; at < piece.offset; at++) {
      if (text[at] === 10) [line, column] = [line + 1, 0];
      else column++;
    }
    if (piece.line === line) push(signed(piece.column - column) * 2);
    else {
      push(signed(piece.line - line) * 2 + 1);
      push(piece.column);
    }
    last = piece;
  }
  return Uint8Array.from(bytes);
}
