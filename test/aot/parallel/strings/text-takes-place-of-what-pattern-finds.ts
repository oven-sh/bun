// String.prototype.replace with a RegExp and a text, where the RegExp matches: every form of the replacement, of the subject and of the RegExp.
const shown = (text: string): string => JSON.stringify(text);
const face = String.fromCodePoint(0x1f600);
const line = "2026-01-02 10:11:12 info worker-7 finished job 8123 in 41 ms, told ann@host.example";

function pieceOf(text: string, start: number, end: number): string {
  return text.substring(start, end);
}

function joined(first: string, second: string): string {
  return first + second;
}

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
  pieceOf("0123456789 " + line + " 0123456789", 11, 11 + line.length),
  pieceOf(line + line, 20, 100),
  joined(line.slice(0, 40), line.slice(40)),
  joined("ann@", "host"),
];

const replacements: string[] = [
  "",
  "-",
  "[it]",
  "$&",
  "<$&>",
  "$1",
  "$2$1",
  "$`",
  "$'",
  "$$",
  "$",
  "$0",
  "$3",
  "$10",
  "$01",
  "$<name>",
  "$<none>",
  "$<",
  "\u0436",
  face,
  "$1" + face + "$&",
];

const patterns: RegExp[] = [
  /\b([a-z0-9-]+)@([a-z0-9-]+)/,
  /\b([a-z0-9-]+)@([a-z0-9-]+)/g,
  /\b([a-z0-9-]+)@([a-z0-9-]+)/i,
  /(?<name>[a-z]+)@(?<host>[a-z]+)/,
  /(?<name>[a-z]+)@(?<host>[a-z]+)/g,
  /(?:(?<name>ann)|(?<name>bob))@/g,
  /^\s+/,
  /\s+$/,
  /\s+/g,
  /^\s*(.*?)\s*$/,
  /a*/,
  /a*/g,
  /(?:)/,
  /(?:)/g,
  /(?:)/gu,
  /x*/gu,
  /./gu,
  /./g,
  /.$/u,
  /[^]/gv,
  /(a)|(b)/g,
  /(z)?a/g,
  /\d+/g,
  /\d{4,}/g,
  /(\d+)-(\d+)-(\d+)/,
  /told/,
  /told/g,
  /a/g,
  /a/,
  /@/g,
  /\u0436/g,
  /\u0436+/,
  /(?<=@)[a-z]+/g,
  /(?<!\d)\d\d(?!\d)/g,
  /$/,
  /$/g,
  /^/gm,
  /\b/g,
  /(((((((((((a)))))))))))/,
];

let answers = 0;
for (const pattern of patterns) {
  for (const subject of subjects) {
    const row: string[] = [];
    for (const replacement of replacements) {
      pattern.lastIndex = 3;
      row.push(shown(subject.replace(pattern, replacement)) + "@" + pattern.lastIndex);
      answers++;
    }
    console.log(String(pattern), shown(subject), row.join(" "));
  }
}
console.log(answers, "answers");

// What the last match leaves behind.
const legacy = RegExp as unknown as Record<string, string>;
function leftBehind(): string {
  return [legacy["$&"], legacy["$1"], legacy["$2"], legacy["$`"], legacy["$'"], legacy["$_"]]
    .map(text => shown(text!))
    .join(" ");
}
for (const pattern of [/(\w+)@(\w+)/, /(\w+)@(\w+)/g, /told/, /told/g, /(\d)(\d)/g, /^(\d+)/]) {
  console.log(String(pattern), shown(line.replace(pattern, "#")), leftBehind());
  console.log(String(pattern), shown(line.replace(pattern, "$2")), leftBehind());
  console.log(String(pattern), shown(line.replace(pattern, "")), leftBehind());
}

// A RegExp that is not as it was made.
const sticky = /\d+/y;
sticky.lastIndex = 5;
console.log(shown(line.replace(sticky, "#")), sticky.lastIndex);
console.log(shown(line.replace(sticky, "#")), sticky.lastIndex);
const stickyAndGlobal = /\d+-?/gy;
stickyAndGlobal.lastIndex = 5;
console.log(shown(line.replace(stickyAndGlobal, "#")), stickyAndGlobal.lastIndex);

const frozen = Object.freeze(/\d+/g);
try {
  console.log(shown(line.replace(frozen, "#")));
} catch (error) {
  console.log("frozen and global:", (error as Error).name);
}
const frozenOnce = Object.freeze(/\d+/);
console.log(shown(line.replace(frozenOnce, "#")), frozenOnce.lastIndex);

const withOwnExec = /\d+/g;
let calls = 0;
(withOwnExec as { exec: (text: string) => RegExpExecArray | null }).exec = function (this: RegExp, text: string) {
  calls++;
  return calls > 2 ? null : RegExp.prototype.exec.call(this, text);
};
console.log(shown(line.replace(withOwnExec, "#")), calls);

class Louder extends RegExp {
  [Symbol.replace](text: string, replacement: string | ((found: string, ...rest: any[]) => string)): string {
    return super[Symbol.replace](text, replacement as string).toUpperCase();
  }
}
console.log(shown(line.replace(new Louder("told|info", "g"), "<$&>")));

const odd = /\d+/g;
(odd as unknown as { lastIndex: unknown }).lastIndex = {
  valueOf() {
    console.log("lastIndex is asked for");
    return 2;
  },
};
console.log(shown(line.replace(odd, "#")), odd.lastIndex);

// Many matches, long subjects.
const long = (line + "\n").repeat(400);
console.log(
  long.replace(/\d+/g, "#").length,
  long.replace(/\d+/g, "").length,
  long.replace(/(\d)(\d)/g, "$2$1").length,
  long.replace(/\n/g, "\r\n").length,
);
console.log(
  long.replace(/example\n$/, "!").length,
  long.replace(/(example)\n$/, "$1!").slice(-12),
  long.replace(/^2026/, "").length,
  long.replace(/\n$/, "").length,
);
const wide = (line + "\u0436\n").repeat(400);
console.log(
  wide.replace(/\d+/g, "#").length,
  wide.replace(/\u0436\n$/, "").length,
  wide.replace(/(\u0436)\n/g, "$1$1").length,
  shown(wide.replace(/(\u0436)\n$/, "<$1>").slice(-8)),
);
