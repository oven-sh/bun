// Where the words of a module of src/js stand in the text that `bun run` evaluates. A stack trace shows lines and columns of that
// text. A bundler made it, and its source map says which token of the output stands for which token of what it was given.
//
// Every Bun holds both texts, and most words of one are found in the other by reading the two side by side. Only the words that such
// a reading gets wrong are written down. src/aot/emit/positions.rs reads the two texts in the same way.

import { alignWords, decodeMappings, formatBundledName, type SourceMap, Text } from "./bundled-names";

const intrinsicPrefix = "__intrinsic__";
const spellWithoutPrefix = (word: string) =>
  word.startsWith(intrinsicPrefix) ? word.slice(intrinsicPrefix.length) : word.startsWith("$") ? word.slice(1) : word;

const isWordCode = (code: number) =>
  (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 95 || code === 36;
const isWordAt = (text: string, index: number) => isWordCode(text.charCodeAt(index));

function endOfWord(text: string, index: number): number {
  while (isWordAt(text, index)) index++;
  return index;
}

const wordAt = (text: string, index: number) => text.slice(index, endOfWord(text, index));

function skipSpaces(text: string, index: number): number {
  for (let code = text.charCodeAt(index); code === 32 || (code >= 9 && code <= 13); code = text.charCodeAt(index))
    index++;
  return index;
}

/**
 * What stands between a word and the next one is alike in both texts but for spaces and for what only says a type. `index` and
 * `evaluatedIndex` are where two words end that stand for each other. Answers where the two texts stop being alike.
 */
function skipWhatIsAlike(written: string, index: number, evaluated: string, evaluatedIndex: number): [number, number] {
  for (;;) {
    index = skipSpaces(written, index);
    evaluatedIndex = skipSpaces(evaluated, evaluatedIndex);
    if (index >= written.length || isWordAt(written, index)) break;
    if (written[index] === "/" && (written[index + 1] === "/" || written[index + 1] === "*")) break;
    if (written[index] === evaluated[evaluatedIndex]) [index, evaluatedIndex] = [index + 1, evaluatedIndex + 1];
    else if (written[index] === "!" && written[index + 1] !== "=") index++;
    else break;
  }
  return [index, evaluatedIndex];
}

/** Index in `given`, the text that the bundler read, of a word > index of the word of `output` that stands for it. */
function findWordsOfOutput(given: string, output: string, map: SourceMap): Map<number, number> {
  const [from, to] = [new Text(given), new Text(output)];
  const found = new Map<number, number>();
  const next = /[\w$]+\s+(?=[\w$])/y;
  for (const mapping of decodeMappings(map.mappings)) {
    const index = from.indexOf(mapping.sourceLine, mapping.sourceColumn);
    const madeIndex = to.indexOf(mapping.line, mapping.column);
    if (!isWordAt(given, index) || isWordAt(given, index - 1)) continue;
    if (!isWordAt(output, madeIndex) || isWordAt(output, madeIndex - 1)) continue;
    const word = wordAt(given, index);
    const isSpelledAlike = wordAt(output, madeIndex) === word;
    if (!isSpelledAlike) {
      // The `else` in front of a statement has the place of the statement, whose first word then has none of its own.
      next.lastIndex = madeIndex;
      const skipped = next.exec(output)?.[0].length ?? 0;
      if (skipped > 0 && wordAt(output, madeIndex + skipped) === word) {
        found.set(index, madeIndex + skipped);
        continue;
      }
    }
    const other = found.get(index);
    if (other !== undefined && (!isSpelledAlike || wordAt(output, other) === word)) continue;
    found.set(index, madeIndex);
  }
  return found;
}

/** The words of a text: `starts[n]` and `ends[n]` are indexes, `spelled[n]` is the word without a `$` in front. */
export class Words {
  readonly starts: number[] = [];
  readonly ends: number[] = [];
  readonly spelled: string[] = [];
  constructor(readonly text: string) {
    for (let at = 0; at < text.length; at++) {
      if (!isWordAt(text, at)) continue;
      const end = endOfWord(text, at);
      this.starts.push(at);
      this.ends.push(end);
      this.spelled.push(text.slice(text[at] === "$" ? at + 1 : at, end));
      at = end;
    }
  }
  get length() {
    return this.starts.length;
  }
}

/**
 * `written`: the module as the compiler reads it. `output`: what the bundler made, with `map`. `evaluated`: what `bun run` evaluates,
 * which is `output` with pieces replaced. Answers, for the number of a word of `written`, the number of the word of `evaluated` that
 * stands for it, or -1: none does. Of a word that is not in the answer nothing is known.
 */
export function findWordsInEvaluatedText(
  written: Words,
  output: string,
  map: SourceMap,
  evaluated: Words,
): Map<number, number> {
  const given = map.sourcesContent[0];
  // A call of a function that only the library can name may stand for a call that is written otherwise.
  const calleesReplaced: [number, number][] = [];
  const writtenOfGiven = alignWords(written.text, given, spellWithoutPrefix, (old, replacement) => {
    const callee = replacement.findLast(word => word.text.startsWith(intrinsicPrefix));
    if (!callee) return;
    for (const word of old) {
      if (written.text[word.index + word.text.length] === "(") calleesReplaced.push([callee.index, word.index]);
    }
  });
  const outputOfGiven = findWordsOfOutput(given, output, map);
  const outputOfEvaluated = alignWords(output, evaluated.text, spellWithoutPrefix);
  const evaluatedOfOutput = new Map([...outputOfEvaluated].map(([to, from]) => [from, to]));
  const numberOfWritten = new Map(written.starts.map((index, number) => [index, number]));
  const numberOfEvaluated = new Map(evaluated.starts.map((index, number) => [index, number]));

  const found = new Map<number, number>();
  for (const [givenIndex, writtenIndex] of [...writtenOfGiven, ...calleesReplaced]) {
    const outputIndex = outputOfGiven.get(givenIndex);
    const evaluatedIndex = outputIndex === undefined ? undefined : evaluatedOfOutput.get(outputIndex);
    if (evaluatedIndex !== undefined)
      found.set(numberOfWritten.get(writtenIndex)!, numberOfEvaluated.get(evaluatedIndex)!);
  }
  // The map has no place for many a word. What follows alike on a word that has one stands for what follows there.
  let [reached, reachedInEvaluated] = [-1, -1];
  for (let number = 0; number < written.length; number++) {
    if (!found.has(number)) {
      if (written.starts[number] !== reached) continue;
      const mark = evaluated.text[reachedInEvaluated];
      const partner =
        numberOfEvaluated.get(mark === "@" || mark === "!" ? reachedInEvaluated + 1 : reachedInEvaluated) ?? -1;
      const standsForIt = partner >= 0 && (written.spelled[number] === evaluated.spelled[partner]) !== (mark === "!");
      found.set(number, standsForIt ? partner : -1);
    }
    const partner = found.get(number)!;
    if (partner < 0) continue;
    [reached, reachedInEvaluated] = skipWhatIsAlike(
      written.text,
      written.ends[number],
      evaluated.text,
      evaluated.ends[partner],
    );
  }
  return found;
}

const farthestLookAhead = 8;
const wordsRemembered = 8;

/**
 * Reads two texts side by side. `partners[n]` is the number of the word of `evaluated` that stands for word `n` of `written`, or -1.
 * The same steps, in the same order, as `Aligner` of src/aot/emit/positions.rs.
 */
export class Aligner {
  /** The next words to look at. */
  written = 0;
  evaluated = 0;
  /** Words of `evaluated` that were passed over: what the bundler moved to the front finds its partner here. */
  passedOver: number[] = [];
  readonly partners: Int32Array;

  constructor(
    readonly a: Words,
    readonly b: Words,
  ) {
    this.partners = new Int32Array(a.length).fill(-1);
  }

  /** The partner of word `written` stands `distance` words from where the reading is. */
  correct(distance: number) {
    this.evaluated += distance;
    this.partners[this.written++] = this.evaluated++;
  }

  /** Word `written` has no partner. */
  passOver() {
    this.written++;
  }

  /** Where the comment ends that word `written` stands in, if the text in front of the word opens one. */
  #endOfComment(): number {
    const { text, starts, ends } = this.a;
    const start = starts[this.written];
    const gap = text.slice(this.written > 0 ? ends[this.written - 1] : 0, start);
    const [line, block] = [gap.lastIndexOf("//"), gap.lastIndexOf("/*")];
    if (line >= 0 && !gap.includes("\n", line)) return text.indexOf("\n", start);
    if (block >= 0 && !gap.includes("*/", block)) return text.indexOf("*/", start);
    return -1;
  }

  /** Decides on one or more words of `written`, none of them at or behind `stop`. */
  step(stop: number) {
    const [a, b] = [this.a.spelled, this.b.spelled];
    const [i, j] = [this.written, this.evaluated];
    if (j < b.length && a[i] === b[j]) {
      this.partners[this.written++] = this.evaluated++;
      return;
    }
    const endOfComment = this.#endOfComment();
    if (endOfComment >= 0) {
      while (this.written < stop && this.a.starts[this.written] < endOfComment) this.written++;
      return;
    }
    let [skipped, skippedOfEvaluated, isFound] = [1, 1, false];
    search: for (let distance = 1; distance <= farthestLookAhead; distance++) {
      for (let s = Math.min(distance, a.length - i); s >= 0; s--) {
        const [x, y] = [i + s, j + distance - s];
        if (x < a.length && y < b.length ? a[x] !== b[y] : x < a.length || y < b.length) continue;
        [skipped, skippedOfEvaluated, isFound] = [s, distance - s, x < a.length];
        break search;
      }
    }
    // Of more words of `written` the first ones say a type; of more words of `evaluated` the last ones were put in.
    const replaced = Math.min(skipped, skippedOfEvaluated);
    const leftOut = skipped - replaced;
    for (let k = 0; k < skipped; k++) {
      if (i + k >= stop) {
        this.evaluated += Math.max(0, k - leftOut);
        return;
      }
      this.written++;
      if (k >= leftOut) {
        if (j + k - leftOut < b.length) this.partners[i + k] = j + k - leftOut;
        continue;
      }
      const moved = this.passedOver.findLastIndex(number => b[number] === a[i + k]);
      if (moved >= 0) [this.partners[i + k]] = this.passedOver.splice(moved, 1);
    }
    for (let k = replaced; k < skippedOfEvaluated && j + k < b.length; k++) this.passedOver.push(j + k);
    if (this.passedOver.length > wordsRemembered) this.passedOver.splice(0, this.passedOver.length - wordsRemembered);
    this.evaluated += skippedOfEvaluated;
    if (isFound && this.written < stop) this.partners[this.written++] = this.evaluated++;
  }
}

/**
 * The words that reading the two texts side by side gets wrong. Each word: how many words
 * it stands behind the last one that is written down, then 0 if it has no partner, or one more than how many words its partner stands
 * from where the reading is, with the sign in the lowest bit.
 */
export function encodeWordsInEvaluatedText(written: Words, evaluated: Words, found: Map<number, number>): Uint8Array {
  return readWithCorrections(written, evaluated, found).corrections;
}

function readWithCorrections(written: Words, evaluated: Words, found: Map<number, number>) {
  const numbers: number[] = [];
  const aligner = new Aligner(written, evaluated);
  let last = 0;
  while (aligner.written < written.length) {
    const [start, startOfEvaluated, passedOver] = [aligner.written, aligner.evaluated, [...aligner.passedOver]];
    aligner.step(written.length);
    let wrong = start;
    while (wrong < aligner.written && (found.get(wrong) ?? aligner.partners[wrong]) === aligner.partners[wrong])
      wrong++;
    if (wrong === aligner.written) continue;
    aligner.partners.fill(-1, start, aligner.written);
    [aligner.written, aligner.evaluated, aligner.passedOver] = [start, startOfEvaluated, passedOver];
    if (wrong > start) aligner.step(wrong);
    numbers.push(wrong - last);
    last = wrong;
    if (found.get(wrong)! < 0) {
      numbers.push(0);
      aligner.passOver();
      continue;
    }
    const distance = found.get(wrong)! - aligner.evaluated;
    numbers.push((distance < 0 ? -distance * 2 - 1 : distance * 2) + 1);
    aligner.correct(distance);
  }
  return { corrections: encodeNumbers(numbers), partners: aligner.partners };
}

/** 7 bits a byte, the lowest first. */
export function encodeNumbers(numbers: number[]): Uint8Array {
  const bytes: number[] = [];
  for (let value of numbers) {
    for (; value >= 128; value = Math.floor(value / 128)) bytes.push((value % 128) | 128);
    bytes.push(value);
  }
  return Uint8Array.from(bytes);
}

export function encodeBundledPositions(written: string, output: string, map: SourceMap, evaluated: string): Uint8Array {
  const [wordsOfWritten, wordsOfEvaluated] = [new Words(written), new Words(evaluated)];
  const found = findWordsInEvaluatedText(wordsOfWritten, output, map, wordsOfEvaluated);
  return encodeWordsInEvaluatedText(wordsOfWritten, wordsOfEvaluated, found);
}

const quoteInFrontOfWord = /\/\* as: (.+?) \*\/\s*/g;

/**
 * `found` has the words of the lines that both texts have. Between two such lines that follow each other in both texts, adds the
 * longest row of words that both texts spell alike in the same order. A stretch of over `mostWordPairs` pairs is left alone.
 */
function alignWordsBetweenLines(second: Words, first: Words, found: Map<number, number>) {
  const mostWordPairs = 1 << 22;
  const taken = new Set(found.values());
  for (let from = 0, to = 0; from < second.length; from = to + 1) {
    for (to = from; to < second.length && !found.has(to);) to++;
    const before = from === 0 ? -1 : found.get(from - 1)!;
    const after = to === second.length ? first.length : found.get(to)!;
    const free: number[] = [];
    for (let number = before + 1; number < after; number++) if (!taken.has(number)) free.push(number);
    const [rows, columns] = [to - from, free.length];
    if (rows === 0 || columns === 0 || rows * columns > mostWordPairs) continue;
    // lengths[row * width + column]: how many words the rest of both stretches has in common.
    const width = columns + 1;
    const lengths = new Uint16Array((rows + 1) * width);
    const isAlike = (row: number, column: number) => second.spelled[from + row] === first.spelled[free[column]];
    for (let row = rows - 1; row >= 0; row--) {
      for (let column = columns - 1; column >= 0; column--) {
        lengths[row * width + column] = isAlike(row, column)
          ? lengths[(row + 1) * width + column + 1] + 1
          : Math.max(lengths[(row + 1) * width + column], lengths[row * width + column + 1]);
      }
    }
    for (let row = 0, column = 0; row < rows && column < columns;) {
      if (isAlike(row, column)) {
        taken.add(free[column]);
        found.set(from + row++, free[column++]);
      } else if (lengths[(row + 1) * width + column] >= lengths[row * width + column + 1]) row++;
      else column++;
    }
  }
}

/**
 * The compiler reads `second` in place of `first`, and a stack trace shows the places of `first`. Answers, for the number of a word
 * of `second`, the number of the word of `first` that it stands for. A line that both texts have equally often stands for the line
 * of the same number. Between such lines, words that both texts have in the same order stand for each other. In front of any other
 * word, a comment `as:` quotes `first` up to the word.
 */
export function findWordsOfFirstText(second: Words, first: Words): Map<number, number> {
  const listLines = (words: Words) => {
    const lines = new Map<string, number[][]>();
    let [start, number] = [0, 0];
    for (const line of words.text.split("\n")) {
      const end = start + line.length;
      const numbers: number[] = [];
      for (; number < words.length && words.starts[number] < end; number++) numbers.push(number);
      if (numbers.length > 0) lines.set(line.trim(), [...(lines.get(line.trim()) ?? []), numbers]);
      start = end + 1;
    }
    return lines;
  };
  const found = new Map<number, number>();
  const linesOfFirst = listLines(first);
  for (const [line, places] of listLines(second)) {
    const partners = linesOfFirst.get(line);
    if (partners?.length !== places.length) continue;
    for (const [n, numbers] of places.entries()) numbers.forEach((number, k) => found.set(number, partners[n][k]));
  }
  alignWordsBetweenLines(second, first, found);
  for (const match of second.text.matchAll(quoteInFrontOfWord)) {
    const quote = match[1];
    const at = first.text.indexOf(quote);
    if (at < 0 || first.text.includes(quote, at + 1)) throw new Error(`The other text does not have "${quote}" once`);
    const number = second.starts.indexOf(match.index + match[0].length);
    const partner = first.ends.indexOf(at + quote.length);
    if (number < 0 || partner < 0) throw new Error(`"${quote}" does not end with a word, or no word follows it`);
    found.set(number, partner);
  }
  return found;
}

/** The same as encodeBundledPositions() for `second`, which the compiler reads in place of `written`. */
export function encodeBundledPositionsOfSecondText(
  second: string,
  written: string,
  output: string,
  map: SourceMap,
  evaluated: string,
): Uint8Array {
  const [wordsOfSecond, wordsOfWritten, wordsOfEvaluated] = [
    new Words(second),
    new Words(written),
    new Words(evaluated),
  ];
  const found = findWordsInEvaluatedText(wordsOfWritten, output, map, wordsOfEvaluated);
  const { partners } = readWithCorrections(wordsOfWritten, wordsOfEvaluated, found);
  const wordsOfFirstText = findWordsOfFirstText(wordsOfSecond, wordsOfWritten);
  const foundOfSecond = new Map<number, number>();
  for (let number = 0; number < wordsOfSecond.length; number++) {
    const partner = wordsOfFirstText.get(number);
    foundOfSecond.set(number, partner === undefined ? -1 : partners[partner]);
  }
  return encodeWordsInEvaluatedText(wordsOfSecond, wordsOfEvaluated, foundOfSecond);
}

/**
 * `lines` are those of listBundledNamesOfModule() for `written`. Answers the lines for `second`, which the compiler reads in its
 * place. An identifier that no word of `second` stands for has none.
 */
export function moveBundledNamesToSecondText(lines: string[], second: string, written: string): string[] {
  const [wordsOfSecond, wordsOfWritten] = [new Words(second), new Words(written)];
  const wordsOfSecondText = new Map<number, number>();
  for (const [number, partner] of findWordsOfFirstText(wordsOfSecond, wordsOfWritten)) {
    if (!wordsOfSecondText.has(partner)) wordsOfSecondText.set(partner, number);
  }
  const bytes = Buffer.from(written);
  return lines.flatMap(line => {
    const [, file, offset, name, kind] = line.split("\t");
    const index = bytes.toString("utf8", 0, Number(offset)).length;
    const number = wordsOfSecondText.get(wordsOfWritten.starts.indexOf(index));
    if (number === undefined) return [];
    return [
      formatBundledName(file, second, wordsOfSecond.starts[number], name === "-" ? undefined : name, kind === "own"),
    ];
  });
}

/** A line for the manifest of the sources. */
export function formatBundledPositions(file: string, encoded: Uint8Array): string {
  return `positions\t${file}\t${Buffer.from(encoded).toString("base64")}`;
}
