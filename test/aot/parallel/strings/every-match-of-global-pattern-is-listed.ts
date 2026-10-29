// String.prototype.match with a global RegExp that is written at the call, where it matches: every form of the subject, matches that are empty, what is left behind.
const shown = (list: string[] | null): string => JSON.stringify(list);
const face = String.fromCodePoint(0x1f600);
const line = "2026-01-02 10:11:12 info worker-7 finished job 8123 in 41 ms, told ann@host.example";

const subjects: string[] = [
  line,
  "",
  "a",
  "aaa",
  "  padded  ",
  "ann@host bob@home",
  "x" + face + "y" + face,
  face,
  "\u00e9t\u00e9 \u00e0 la mer",
  "\u0436\u0436 ann@host \u0436",
  ("0123456789 " + line + " 0123456789").substring(11, 11 + line.length),
  (line + line).substring(20, 100),
  line.slice(0, 40) + line.slice(40),
];

const legacy = RegExp as unknown as Record<string, string>;
const leftBehind = (): string => JSON.stringify([legacy["$&"], legacy["$1"], legacy["$`"], legacy["$'"]]);

for (const subject of subjects) {
  /^/.test("");
  console.log(JSON.stringify(subject));
  console.log(" digits", shown(subject.match(/\d+/g)), leftBehind());
  console.log(" addresses", shown(subject.match(/([a-z]+)@([a-z]+)/g)), leftBehind());
  console.log(" runs of a", shown(subject.match(/a*/g)), leftBehind());
  console.log(" nothing", shown(subject.match(/(?:)/g)), leftBehind());
  console.log(" nothing, by code points", shown(subject.match(/(?:)/gu)), leftBehind());
  console.log(" units", shown(subject.match(/./g)), leftBehind());
  console.log(" code points", shown(subject.match(/./gu)), leftBehind());
  console.log(" anything", shown(subject.match(/[^]/gv)), leftBehind());
  console.log(" edges of words", shown(subject.match(/\b/g)), leftBehind());
  console.log(" a text", shown(subject.match(/told/g)), leftBehind());
  console.log(" one of two", shown(subject.match(/(a)|(o)/g)), leftBehind());
  console.log(" the end", shown(subject.match(/$/g)), leftBehind());
  console.log(" starts of lines", shown(subject.match(/^/gm)), leftBehind());
  console.log(" behind a sign", shown(subject.match(/(?<=@)[a-z]+/g)), leftBehind());
  console.log(" in either case", shown(subject.match(/[A-F]+/gi)), leftBehind());
  console.log(" from where it stands", shown(subject.match(/\d+-?/gy)), leftBehind());
  console.log(" a letter beyond Latin-1", shown(subject.match(/\u0436/g)), leftBehind());
}

const many = "ab".repeat(100003);
const listed = many.match(/a|c/g)!;
console.log(listed.length, listed[0], listed[100002], leftBehind().length);
console.log(many.match(/(?:)/g)!.length, many.match(/b(?=a)/g)!.length);

const kept = /\d+/g;
kept.lastIndex = 7;
console.log(shown(line.match(kept)), kept.lastIndex);
const frozen = Object.freeze(/\d+/g);
try {
  console.log(shown(line.match(frozen)));
} catch (error) {
  console.log("frozen:", (error as Error).name);
}
