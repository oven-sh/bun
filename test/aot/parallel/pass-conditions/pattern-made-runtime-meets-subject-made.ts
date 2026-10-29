// A pattern made at run time meets a subject made from it.
// test-twice match from-every-last-index replace-function frozen match-all last-index-huge | fits behind-many false-starts fits between behind-many between fits damaged fits damaged between between damaged between two
type Case = { pieces: string[]; flags: string; head: string; unit: string; count: number; tail: string };
function show(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 24 ? JSON.stringify(value.slice(0, 12)) + ".." + value.length + "#" + hashOf(value) : JSON.stringify(value);
  if (Array.isArray(value)) {
    const match = value as RegExpMatchArray & { indices?: unknown };
    let text = "[" + (value.length > 12 ? value.slice(0, 12).map(show).join() + ".." + value.length : value.map(show).join()) + "]";
    if (typeof match.index === "number") text += "@" + match.index;
    if (match.groups) text += "{" + Object.entries(match.groups).map(([name, group]) => name + ":" + show(group)).join() + "}";
    if (match.indices) text += "i" + JSON.stringify(match.indices).slice(0, 80);
    return text;
  }
  return String(value);
}
function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}
function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).name;
  }
}
function subjectOf(one: Case): string {
  return one.head + one.unit.repeat(one.count) + one.tail;
}
function textOf(one: Case): string {
  let text = "";
  for (const piece of one.pieces) text += piece;
  return text;
}
const cases: Case[] = JSON.parse("[{\"pieces\":[\"\\\\ud7ff$\"],\"flags\":\"iu\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"퟿\"},{\"pieces\":[\"^1ﬀ\\\\u005f\\\\u{41}\\\\u{65}[^\\\\n]\"],\"flags\":\"iu\",\"head\":\"\",\"unit\":\"💩\",\"count\":4093,\"tail\":\"1ﬀ_Aeẞÿ\"},{\"pieces\":[\"[\\\\u{1f6\",\"00}-\\\\u{1f64f}]??\\\\ud7ffµ[^a]B\"],\"flags\":\"yu\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"\\ud830𜍅𜍅퟿µ𐀀B\"},{\"pieces\":[\"\\\\W(?<!😍)[\\\\u{1f600}-\\\\u{1f64f}]((?=\\\\W)\\\\W[\\\\p{L}\\\\p{N}_\\\\-](?<=[\\\\p{L}\\\\p{N}_\\\\-])\\\\b|\\\\u212aÿ\\\\p{Ll})\"],\"flags\":\"giu\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"☃😀Kÿa\"},{\"pieces\":[\"(?:.🇺\\\\p{Script=Greek}|.|\\\\ud83d\\\\ude4f.{1,3}([\\\\ud800-\\\\udbff]|\\\\u{20}\\\\D?|\\\\u002d\\ud800))(?=[^a-c])\\\\S\"],\"flags\":\"gu\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"ſ𐀀🙏􏿿\\ud800 𜍅ẞ𝟘\"},{\"pieces\":[\"\\\\u{30}\\\\p{Any}[\\\\u0100-\\\\uffff]??__1\\\\x\",\"78\"],\"flags\":\"yv\",\"head\":\"\",\"unit\":\"一\",\"count\":260,\"tail\":\"0𐐨__1x\"},{\"pieces\":[\"\\\\W\\\\S?\"],\"flags\":\"i\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"😀􏿿🇺\"},{\"pieces\":[\"[\\\\p{L}\\\\p{N}_\\\\-]{2}?\"],\"flags\":\"du\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"_a\"},{\"pieces\":[\"𝟘e😍\"],\"flags\":\"v\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"𝟘E😍\"},{\"pieces\":[\".(?<!1)\"],\"flags\":\"g\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"😀\"},{\"pieces\":[\"\\\\u{63}[^α]\\\\p{RGI_Emoji}{0,2}((?=[\\\\u0000-\\\\u{10ffff}])𐀀+[x]\\\\ud83d)[α-ω]$\"],\"flags\":\"dgimsvy\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"😍c𐀀x\\ud83dς\"},{\"pieces\":[\"^\\\\xff[^\\\\s]+\\\\u{63}c\"],\"flags\":\"v\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"K𜍅𠀀ÿ🇺\\ud83d￿cc\\ud83d\"},{\"pieces\":[\"^[^x]\\\\u{212a}\\\\u{78}😀\"],\"flags\":\"gsu\",\"head\":\"😀ÿ\",\"unit\":\"\",\"count\":0,\"tail\":\"eKx😀\"},{\"pieces\":[\"\\\\x66f\\\\P{L}?\\ud800$\"],\"flags\":\"sv\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"FF\\ud800\"},{\"pieces\":[\"\\\\\",\"b\"],\"flags\":\"yu\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"￿😍eſ\"},{\"pieces\":[\"[^\\\\s]\\\\\",\"u0062𐐀\\\\p{Ll}(?<=\\\\p{Ll})$\"],\"flags\":\"mu\",\"head\":\"\",\"unit\":\"\",\"count\":0,\"tail\":\"Σb𐐀é😀￿b𐐀ß\"}]");
const written: ((() => RegExp) | undefined)[] = [
  undefined,
  undefined,
  undefined,
  () => /\W(?<!😍)[\u{1f600}-\u{1f64f}]((?=\W)\W[\p{L}\p{N}_\-](?<=[\p{L}\p{N}_\-])\b|\u212aÿ\p{Ll})/giu,
  () => /(?:.🇺\p{Script=Greek}|.|\ud83d\ude4f.{1,3}([\ud800-\udbff]|\u{20}\D?|\u002d�))(?=[^a-c])\S/gu,
  () => /\u{30}\p{Any}[\u0100-\uffff]??__1\x78/yv,
  undefined,
  () => /[\p{L}\p{N}_\-]{2}?/du,
  () => /𝟘e😍/v,
  undefined,
  undefined,
  () => /^\xff[^\s]+\u{63}c/v,
  () => /^[^x]\u{212a}\u{78}😀/gsu,
  undefined,
  () => /\b/yu,
  () => /[^\s]\u0062𐐀\p{Ll}(?<=\p{Ll})$/mu,
];
function made(one: Case): RegExp | string {
  try {
    const literal = written[cases.indexOf(one)];
    if (literal) return literal();
    return new RegExp(textOf(one), one.flags);
  } catch (error) {
    return (error as Error).name;
  }
}
function run(one: Case, at: number): void {
  const s = subjectOf(one);
  let line = at + ":";
  {
    const re = made(one);
    if (typeof re === "string") line += " " + re;
    else line += " test-twice " + attempt(() => String(re.test(s)) + re.lastIndex + re.test(s)) + "," + re.lastIndex;
  }
  {
    const re = made(one);
    if (typeof re === "string") line += " " + re;
    else line += " match " + attempt(() => s.match(re)) + "," + re.lastIndex;
  }
  {
    const re = made(one);
    if (typeof re === "string") line += " " + re;
    else line += " from-every-last-index " + attempt(() => {
      let all = "";
      for (let from = 0; from <= Math.min(s.length, 9); from++) {
        re.lastIndex = from;
        all += show(re.exec(s)) + re.lastIndex + " ";
      }
      return all;
    }) + "," + re.lastIndex;
  }
  {
    const re = made(one);
    if (typeof re === "string") line += " " + re;
    else line += " replace-function " + attempt(() => s.replace(re, (...parts: unknown[]) => "<" + parts.slice(0, -2).map(part => (typeof part === "object" ? "groups" : show(part))).join() + ">")) + "," + re.lastIndex;
  }
  {
    const re = made(one);
    if (typeof re === "string") line += " " + re;
    else line += " frozen " + (() => {
      const own = Object.freeze(new RegExp(re));
      return attempt(() => own.exec(s)) + attempt(() => s.replace(own, "-")) + attempt(() => s.match(own));
    })() + "," + re.lastIndex;
  }
  {
    const re = made(one);
    if (typeof re === "string") line += " " + re;
    else line += " match-all " + attempt(() => [...s.matchAll(re)].slice(0, 6).map(show).join()) + "," + re.lastIndex;
  }
  {
    const re = made(one);
    if (typeof re === "string") line += " " + re;
    else line += " last-index-huge " + attempt(() => {
      re.lastIndex = 4294967296;
      return show(re.exec(s)) + re.lastIndex;
    }) + "," + re.lastIndex;
  }
  console.log(line);
}
for (let at = 0; at < cases.length; at++) run(cases[at], at);
