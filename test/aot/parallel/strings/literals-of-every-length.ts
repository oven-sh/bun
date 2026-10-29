// String literals of 1 to 9, 255, 256 and 300 characters are compared with strings in every internal representation, with near misses and with values that are not strings: === and == on `any`, and ===, startsWith and endsWith on `string`.
// Only the jsc shell with --aotCountsPath=<path> can count calls into the runtime. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number | null);
const readCount = typeof aotOperationCount === "function" ? aotOperationCount : () => null;
const canCount = readCount("operationAOTStringEqualsLiteral") !== null;
const slowComparisons = (): number => (readCount("operationAOTStringEqualsLiteral") ?? 0) + (readCount("operationAOTStringEqualsLiteralInRegister") ?? 0);

function compareAny1(value: any): number { return (value === "k" ? 1 : 0) | (value == "k" ? 2 : 0); }
function compareString1(text: string): number { return (text === "k" ? 1 : 0) | (text.startsWith("k") ? 2 : 0) | (text.endsWith("k") ? 4 : 0); }
function compareAny2(value: any): number { return (value === "kL" ? 1 : 0) | (value == "kL" ? 2 : 0); }
function compareString2(text: string): number { return (text === "kL" ? 1 : 0) | (text.startsWith("kL") ? 2 : 0) | (text.endsWith("kL") ? 4 : 0); }
function compareAny3(value: any): number { return (value === "kLm" ? 1 : 0) | (value == "kLm" ? 2 : 0); }
function compareString3(text: string): number { return (text === "kLm" ? 1 : 0) | (text.startsWith("kLm") ? 2 : 0) | (text.endsWith("kLm") ? 4 : 0); }
function compareAny4(value: any): number { return (value === "kLmN" ? 1 : 0) | (value == "kLmN" ? 2 : 0); }
function compareString4(text: string): number { return (text === "kLmN" ? 1 : 0) | (text.startsWith("kLmN") ? 2 : 0) | (text.endsWith("kLmN") ? 4 : 0); }
function compareAny5(value: any): number { return (value === "kLmNo" ? 1 : 0) | (value == "kLmNo" ? 2 : 0); }
function compareString5(text: string): number { return (text === "kLmNo" ? 1 : 0) | (text.startsWith("kLmNo") ? 2 : 0) | (text.endsWith("kLmNo") ? 4 : 0); }
function compareAny6(value: any): number { return (value === "kLmNoP" ? 1 : 0) | (value == "kLmNoP" ? 2 : 0); }
function compareString6(text: string): number { return (text === "kLmNoP" ? 1 : 0) | (text.startsWith("kLmNoP") ? 2 : 0) | (text.endsWith("kLmNoP") ? 4 : 0); }
function compareAny7(value: any): number { return (value === "kLmNoPq" ? 1 : 0) | (value == "kLmNoPq" ? 2 : 0); }
function compareString7(text: string): number { return (text === "kLmNoPq" ? 1 : 0) | (text.startsWith("kLmNoPq") ? 2 : 0) | (text.endsWith("kLmNoPq") ? 4 : 0); }
function compareAny8(value: any): number { return (value === "kLmNoPqR" ? 1 : 0) | (value == "kLmNoPqR" ? 2 : 0); }
function compareString8(text: string): number { return (text === "kLmNoPqR" ? 1 : 0) | (text.startsWith("kLmNoPqR") ? 2 : 0) | (text.endsWith("kLmNoPqR") ? 4 : 0); }
function compareAny9(value: any): number { return (value === "kLmNoPqRs" ? 1 : 0) | (value == "kLmNoPqRs" ? 2 : 0); }
function compareString9(text: string): number { return (text === "kLmNoPqRs" ? 1 : 0) | (text.startsWith("kLmNoPqRs") ? 2 : 0) | (text.endsWith("kLmNoPqRs") ? 4 : 0); }
function compareAny255(value: any): number { return (value === "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUf" ? 1 : 0) | (value == "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUf" ? 2 : 0); }
function compareString255(text: string): number { return (text === "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUf" ? 1 : 0) | (text.startsWith("wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUf") ? 2 : 0) | (text.endsWith("wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUf") ? 4 : 0); }
function compareAny256(value: any): number { return (value === "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW" ? 1 : 0) | (value == "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW" ? 2 : 0); }
function compareString256(text: string): number { return (text === "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW" ? 1 : 0) | (text.startsWith("wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW") ? 2 : 0) | (text.endsWith("wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW") ? 4 : 0); }
function compareAny300(value: any): number { return (value === "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW5k2uhRaTIrKxgoy2i70usIN7LUAjLBZax1rz4g1ZsWzp" ? 1 : 0) | (value == "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW5k2uhRaTIrKxgoy2i70usIN7LUAjLBZax1rz4g1ZsWzp" ? 2 : 0); }
function compareString300(text: string): number { return (text === "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW5k2uhRaTIrKxgoy2i70usIN7LUAjLBZax1rz4g1ZsWzp" ? 1 : 0) | (text.startsWith("wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW5k2uhRaTIrKxgoy2i70usIN7LUAjLBZax1rz4g1ZsWzp") ? 2 : 0) | (text.endsWith("wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW5k2uhRaTIrKxgoy2i70usIN7LUAjLBZax1rz4g1ZsWzp") ? 4 : 0); }

type Case = { literal: string; compareAny: (value: any) => number; compareString: (text: string) => number };
const cases: Case[] = [
  { literal: "k", compareAny: compareAny1, compareString: compareString1 },
  { literal: "kL", compareAny: compareAny2, compareString: compareString2 },
  { literal: "kLm", compareAny: compareAny3, compareString: compareString3 },
  { literal: "kLmN", compareAny: compareAny4, compareString: compareString4 },
  { literal: "kLmNo", compareAny: compareAny5, compareString: compareString5 },
  { literal: "kLmNoP", compareAny: compareAny6, compareString: compareString6 },
  { literal: "kLmNoPq", compareAny: compareAny7, compareString: compareString7 },
  { literal: "kLmNoPqR", compareAny: compareAny8, compareString: compareString8 },
  { literal: "kLmNoPqRs", compareAny: compareAny9, compareString: compareString9 },
  { literal: "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUf", compareAny: compareAny255, compareString: compareString255 },
  { literal: "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW", compareAny: compareAny256, compareString: compareString256 },
  { literal: "wgkGMNvKP91VTQmeyGGNTroYQFHT4Lux01JJe8BYftpPS2XZ1J3qJwA1QbLyCqzP6Di5oujkEq6zZKEC7Wqzj4vYdqff5FcLyIC47HQmTvBP3JOr1lN9QZ7JP2DBl9Fg4DZjedp5C11IfiJmKU0PxBVaJ6CCdTBLe5RZh3ebofyvnKNxvggjw7XRa9bkjV5qGQ5wSoqwVFaVqhXGac9a6wiId970yY1oStTD8jhwH1GPTvNdTIx8jwzbBup5aUfW5k2uhRaTIrKxgoy2i70usIN7LUAjLBZax1rz4g1ZsWzp", compareAny: compareAny300, compareString: compareString300 },
];

const opaque = new Function("value", "return value") as <T>(value: T) => T;
const flat = (text: string): string => opaque(text.split("").join(""));
const substring = (text: string): string => flat("<" + text + ">").slice(1, -1);
const rope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + flat(text.slice(1)));
const wideFlat = (text: string): string => flat(text + "ā").replace("ā", "");
const wideSubstring = (text: string): string => flat("ā" + text).slice(1);
const representations = [flat, substring, rope, wideFlat, wideSubstring];

const changedAt = (text: string, at: number, by: (unit: number) => number): string => text.slice(0, at) + String.fromCharCode(by(text.charCodeAt(at))) + text.slice(at + 1);

// Both ends, the seams between the words that a comparison loads, and the middle.
function changedPositions(length: number): number[] {
  const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8, length >> 1, length - 9, length - 8, length - 5, length - 4, length - 2, length - 1];
  return [...new Set(positions)].filter(at => at >= 0 && at < length).sort((a, b) => a - b);
}

for (const { literal, compareAny, compareString } of cases) {
  const length = literal.length;
  const answers = (texts: string[]): string => {
    let line = "";
    for (const text of texts) {
      for (const make of representations) {
        const subject = make(text);
        line += ` ${compareAny(subject)}${compareString(subject)}`;
      }
    }
    return line;
  };
  console.log(length, "equal:" + answers([literal]));
  console.log(length, "one character changed:" + answers(changedPositions(length).map(at => changedAt(literal, at, () => 35))));
  console.log(length, "last character plus 0x80, plus 0x100:" + answers([changedAt(literal, length - 1, unit => unit + 0x80), changedAt(literal, length - 1, unit => unit + 0x100)]));
  console.log(length, "shorter:" + answers([literal.slice(0, -1), literal.slice(1), ""]));
  console.log(length, "longer:" + answers([literal + "s", "s" + literal, literal + literal]));
  const others: unknown[] = [undefined, null, 0, NaN, true, 10n, Symbol(literal), {}, { toString() { return literal; } }, { valueOf() { return literal; } }, [literal], new String(literal)];
  console.log(length, "not strings:", others.map(value => compareAny(value)).join(" "));
}

function compareAnyLatin1(value: any): number { return (value === "café" ? 1 : 0) | (value == "café" ? 2 : 0); }
function compareStringLatin1(text: string): number { return (text === "café" ? 1 : 0) | (text.startsWith("café") ? 2 : 0) | (text.endsWith("café") ? 4 : 0); }
function compareAny16Bit(value: any): number { return (value === "cafē" ? 1 : 0) | (value == "cafē" ? 2 : 0); }
function compareString16Bit(text: string): number { return (text === "cafē" ? 1 : 0) | (text.startsWith("cafē") ? 2 : 0) | (text.endsWith("cafē") ? 4 : 0); }

const nonASCIICases: Case[] = [
  { literal: "café", compareAny: compareAnyLatin1, compareString: compareStringLatin1 },
  { literal: "cafē", compareAny: compareAny16Bit, compareString: compareString16Bit },
];
for (const { literal, compareAny, compareString } of nonASCIICases) {
  // The last two are the UTF-8 encodings of the two literals, read as Latin-1.
  const texts = [literal, "cafe", "caf", literal + "s", "s" + literal, "cafÃ©", "cafÄ\u0093"];
  let line = "";
  for (const text of texts) {
    for (const make of representations) {
      const subject = make(text);
      line += ` ${compareAny(subject)}${compareString(subject)}`;
    }
  }
  console.log(JSON.stringify(literal), "not ASCII:" + line);
}

for (const { literal, compareAny, compareString } of cases) {
  const whole = flat(literal);
  const base = flat("<" + literal + ">");
  const before = slowComparisons();
  let sum = 0;
  for (let round = 0; round < 2500; round++) {
    const part = base.slice(1, -1);
    sum += compareAny(whole) + compareString(whole) + compareAny(part) + compareString(part);
  }
  const calls = slowComparisons() - before;

  const wide = wideSubstring(literal);
  const beforeWide = slowComparisons();
  const wideAnswers = `${compareAny(wide)}${compareString(wide)}`;
  const wideCalls = slowComparisons() - beforeWide;

  const problems: string[] = [];
  if (literal.length <= 255 && calls > 0) problems.push(`${calls} calls for flat strings and substrings`);
  // One Latin-1 character is always the shared 8-bit string, and two ASCII characters cut out of a 16-bit string make an 8-bit string.
  if (literal.length <= 2 && wideCalls > 0) problems.push(`${wideCalls} calls for a piece of a 16-bit string that is an 8-bit string`);
  if (canCount && literal.length > 2 && wideCalls === 0) problems.push("no call for a 16-bit string");
  console.log(literal.length, sum, wideAnswers, problems.length ? problems.join("; ") : "calls as expected");
}
