// A string that is used as a property key takes the storage of the equal key that is there already, in 8 bits or in 16. The parts that were cut out of it before, and the ropes that hold it, go on: their characters lie
// where the string keeps them now, in the width in which it keeps them now.
//
//   texts, uses, homes   those of strings-still-in-pieces.ts, and uses of its own: texts that grow, query parameters, node:path, node:url, paths handed to the file system, Buffer in every encoding, loops over the characters
//   shape      a slice, a substring, a slice of a slice, a group of a match, an argument of a replacer, a part of a split, what node:path cuts out of a path, what trim leaves; slices joined, flat strings joined by +, by a
//              template and by concat, pieces of pieces; the flat string itself
//   direction  8 bits that become 16, 16 bits that become 8
//   when       before the part is handed out, or later: between two uses, in the second turn of a loop, in a callback, behind a wait, in a handler
//   how        the two copies are made in several ways and the key is asked in several ways, one after the other
//
// Each use runs on the part and on a flat twin of the same text, and must answer alike. The program prints what is wrong, and a digest of all answers.
import type { Random } from "./random";
import { dimensions as shared, programOf, type More, type Point } from "./strings-still-in-pieces";

const prelude = `declare const TextDecoder: any;
const keysOfEitherWidth: Record<string, number> = Object.create(null);
let copies = 0;
let lookUps = 0;
function fitsIn8Bits(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 255) return false;
  return true;
}
function in16Bits(text: string): string {
  const middle = text.length >> 1;
  if (middle === 0 || !fitsIn8Bits(text)) return Buffer.from(text, "utf16le").toString("utf16le");
  switch (copies++ % 5) {
    case 0:
      return new TextDecoder("utf-16le").decode(Buffer.from(text, "utf16le"));
    case 1:
      return (text.slice(0, middle) + "\\u0100" + text.slice(middle)).split("\\u0100").join("");
    case 2:
      return (text.slice(0, middle) + "\\u0100" + text.slice(middle)).replace(/\\u0100/g, "");
    case 3:
      return JSON.parse('["\\u0100",' + JSON.stringify(text) + "]")[1];
    default:
      return Buffer.from(text, "utf16le").toString("utf16le");
  }
}
function in8Bits(text: string): string {
  if (!fitsIn8Bits(text)) return in16Bits(text);
  switch (copies++ % 3) {
    case 0:
      return flatTwin(text);
    case 1:
      return [text.slice(0, text.length >> 1), text.slice(text.length >> 1)].join("");
    default:
      return Buffer.from(text, "latin1").toString("latin1");
  }
}
function beside16BitKey(text: string): string {
  keysOfEitherWidth[in16Bits(text)] = 1;
  return in8Bits(text);
}
function beside8BitKey(text: string): string {
  keysOfEitherWidth[in8Bits(text)] = 1;
  return in16Bits(text);
}
function lookUp(text: string): void {
  let found = false;
  switch (lookUps++ % 5) {
    case 0:
      found = keysOfEitherWidth[text] === 1;
      break;
    case 1:
      found = text in keysOfEitherWidth;
      break;
    case 2:
      found = Object.hasOwn(keysOfEitherWidth, text);
      break;
    case 3:
      found = Reflect.get(keysOfEitherWidth, text) === 1;
      break;
    default:
      found = Object.keys({ [text]: 1 }).length === 1;
  }
  if (!found) wrong.add("a key is gone");
}
const waiting: string[] = [];
function lookUpLater(text: string): void {
  waiting.push(text);
}
function lookUpWhatWaits(): void {
  for (const text of waiting.splice(0)) lookUp(text);
}`;

type Direction = { base: string; open: string; close: string; shift: number };
const directions: Record<string, Direction> = {
  "becomes-16-bit": { base: "beside16BitKey", open: "<<", close: ">>", shift: 0 },
  "becomes-8-bit": { base: "beside8BitKey", open: "((", close: "))", shift: 1 },
};
const times: Record<string, string> = { before: "lookUp", later: "lookUpLater" };

/** A part of `whole`, which is the text between two characters on either side. */
const partOf = (part: string) => (d: Direction, change: string) =>
  `const whole = ${d.base}("${d.open}" + p.join("") + "${d.close}");\n  const part = ${part};\n  ${change}(whole);\n  return part;`;
/** The text in `count` flat strings, joined. */
const joined = (count: number, joint: string, changed: number[]) => (d: Direction, change: string) =>
  `const text = p.join("");
  if (text.length < ${count + 1}) return text;
  const step = Math.floor(text.length / ${count});
  const f: string[] = [];
  for (let i = 0; i < ${count}; i++) f.push(${d.base}(text.slice(i === 0 ? 0 : i * step + ${d.shift}, i === ${count - 1} ? text.length : (i + 1) * step + ${d.shift})));
  const rope = ${joint};
  ${changed.map(at => `${change}(f[${at}]);`).join("\n  ")}
  return rope;`;

const shapes: Record<string, (d: Direction, change: string) => string> = {
  slice: partOf("whole.slice(2, whole.length - 2)"),
  "slice-from-the-end": partOf("whole.slice(2, -2)"),
  substring: partOf("whole.substring(2, whole.length - 2)"),
  substr: partOf("(whole as any).substr(2, whole.length - 4)"),
  "slice-of-a-slice": partOf("whole.slice(1, whole.length - 1).slice(1, -1)"),
  "group-of-a-match": partOf("/^..([^]*)..$/.exec(whole)![1]"),
  "argument-of-a-replacer": partOf(
    '(() => {\n    let group = "";\n    whole.replace(/^..([^]*)..$/, (_, found: string) => ((group = found), ""));\n    return group;\n  })()',
  ),
  "part-of-a-split": (d, change) =>
    `const whole = ${d.base}("${d.open}\\u0001" + p.join("") + "\\u0001${d.close}");\n  const part = whole.split("\\u0001")[1];\n  ${change}(whole);\n  return part;`,
  "part-of-a-split-by-pattern": (d, change) =>
    `const whole = ${d.base}("${d.open}\\u0001" + p.join("") + "\\u0001${d.close}");\n  const part = whole.split(/\\u0001/)[1];\n  ${change}(whole);\n  return part;`,
  "folder-of-a-path": (d, change) =>
    `const whole = ${d.base}(p.join("") + "/${d.close}");\n  const part: string = require("node:path").posix.dirname(whole);\n  ${change}(whole);\n  return part;`,
  "name-in-a-path": (d, change) =>
    `const whole = ${d.base}("${d.open}/" + p.join(""));\n  const part: string = require("node:path").posix.basename(whole);\n  ${change}(whole);\n  return part;`,
  "what-trim-leaves": (d, change) =>
    `const whole = ${d.base}(" ".repeat(${d.shift + 1}) + p.join("") + "\\n");\n  const part = whole.trim();\n  ${change}(whole);\n  return part;`,
  "sliced-again-afterwards": (d, change) =>
    `const whole = ${d.base}("${d.open}" + p.join("") + "${d.close}");\n  const part = whole.slice(1, whole.length - 1);\n  ${change}(whole);\n  return part.slice(1, -1);`,
  "slices-joined": (d, change) =>
    `const whole = ${d.base}("${d.open}" + p.join("") + "${d.close}");\n  const middle = whole.length >> 1;\n  const rope = whole.slice(2, middle) + whole.slice(middle, whole.length - 2);\n  ${change}(whole);\n  return rope;`,
  "two-flat-strings": joined(2, "f[0] + f[1]", [0, 1]),
  "two-flat-strings-and-the-first-changes": joined(2, "f[0] + f[1]", [0]),
  "two-flat-strings-and-the-last-changes": joined(2, "f[0] + f[1]", [1]),
  "three-flat-strings": joined(3, "f[0] + f[1] + f[2]", [1]),
  "three-flat-strings-at-once": joined(3, "`${f[0]}${f[1]}${f[2]}`", [0, 2]),
  "flat-strings-by-concat": joined(2, "f[0].concat(f[1])", [0, 1]),
  "pieces-of-pieces": joined(4, "(f[0] + f[1]) + (f[2] + f[3])", [0, 3]),
  "a-flat-string-and-a-slice": (d, change) =>
    `const text = p.join("");\n  const middle = (text.length >> 1) + ${d.shift};\n  const left = ${d.base}(text.slice(0, middle));\n  const whole = ${d.base}("${d.open}" + text.slice(middle) + "${d.close}");\n  const rope = left + whole.slice(2, whole.length - 2);\n  ${change}(left);\n  ${change}(whole);\n  return rope;`,
  "the-flat-string-itself": (d, change) => `const whole = ${d.base}(p.join(""));\n  ${change}(whole);\n  return whole;`,
};

const makers: More["makers"] = {};
for (const [shape, body] of Object.entries(shapes))
  for (const [direction, d] of Object.entries(directions))
    for (const [time, change] of Object.entries(times)) makers[`${shape}--${direction}--${time}`] = body(d, change);

const small = 3000;
const caught = (expression: string, answer = "(error as Error).name") =>
  `(() => {\n    try {\n      return ${expression};\n    } catch (error) {\n      return ${answer};\n    }\n  })()`;
const path = (platform: string, call: string) => `require("node:path").${platform}.${call}`;
const uses: More["uses"] = [
  [
    "grown-in-a-loop",
    '(() => {\n    let all = "";\n    for (let i = 0; i < 3; i++) all += s + ",";\n    return all;\n  })()',
    200000,
  ],
  [
    "grown-behind-text",
    '(() => {\n    let all = "start:";\n    for (let i = 0; i < 3; i++) all += s;\n    return all;\n  })()',
    200000,
  ],
  [
    "grown-among-numbers",
    '(() => {\n    let all = "";\n    for (let i = 0; i < 4; i++) all += i + s + i;\n    return all;\n  })()',
    200000,
  ],
  [
    "grown-from-a-list",
    '(() => {\n    let all = "";\n    for (const each of [s, "x", s]) all += each + ";";\n    return all;\n  })()',
    200000,
  ],
  ["template-among-others", "`a-${s}-${s.length}-${s}`"],
  ["plus-among-others", '"[" + s + "]" + s.length + s'],
  ["joined-among-others", '["a", s, "b", s].join("-")'],
  ["json-of-fields", "JSON.stringify({ first: s, second: [s, 1], third: { s } })"],
  ["json-as-key", "JSON.stringify({ [s]: 1 })", small],
  ["json-of-an-instance", "JSON.stringify(new Holder(s, 1))"],
  ["json-of-instances", 'JSON.stringify([new Holder(s, 1), new Point(1, 2, s), new Holder("plain", 2)])'],
  [
    "json-of-an-instance-with-more-members",
    "(() => {\n    const point = new Point(1, 2, s);\n    (point as any).more = s.length;\n    return JSON.stringify({ point }) + JSON.stringify(point);\n  })()",
  ],
  [
    "json-of-an-instance-with-it-as-one-more-member",
    '(() => {\n    const point = new Point(1, 2, "plain");\n    (point as any).more = s;\n    return JSON.stringify({ point, list: [point] });\n  })()',
  ],
  ["json-parse-reviver", caught("JSON.stringify(JSON.parse(s, (_, value) => value))"), small],
  [
    "units-summed",
    "(() => {\n    let n = 0;\n    for (let i = 0; i < s.length; i++) n = (Math.imul(n, 31) + s.charCodeAt(i)) | 0;\n    return n;\n  })()",
    200000,
  ],
  [
    "elements-joined",
    '(() => {\n    let all = "";\n    for (let i = 0; i < s.length && i < 40; i++) all += s[i];\n    return all;\n  })()',
  ],
  [
    "code-points-summed",
    "(() => {\n    let n = 0;\n    for (let i = 0; i < s.length && i < 400; i++) n = (Math.imul(n, 31) + s.codePointAt(i)!) | 0;\n    return n;\n  })()",
  ],
  ["equal-in-16-bits", 's === in16Bits(flatTwin(s + ""))'],
  ["equal-in-8-bits", 's === in8Bits(flatTwin(s + ""))'],
  ["less-in-16-bits", 's < in16Bits(flatTwin(s + "a"))'],
  ["starts-with-a-part", "s.startsWith(s.slice(0, 3))"],
  ["ends-with-a-part", "s.endsWith(s.slice(-3))"],
  ["includes-a-part", "s.includes(s.slice(1, 4))"],
  ["index-of-a-part", "s.indexOf(s.slice(2, 5), 1)"],
  ["last-index-of-a-part", "s.lastIndexOf(s.slice(0, 2))"],
  [
    "map-and-twin",
    '(() => {\n    const m = new Map<string, number>();\n    m.set(s, 1);\n    return m.get(flatTwin(s + ""));\n  })()',
  ],
  ["set-and-twin", 'new Set<string>([s, flatTwin(s + "")]).size'],
  [
    "object-and-twin",
    '(() => {\n    const o: Record<string, number> = {};\n    o[s] = 1;\n    return o[flatTwin(s + "")];\n  })()',
    small,
  ],
  ["key-back", "Object.keys({ [s]: 1 })[0]", small],
  ["parameters-get-by", 'new URLSearchParams("alpha=1&beta=2&ab=3&42=4&length=5").get(s)', small],
  ["parameters-has-by", 'new URLSearchParams("alpha=1&beta=2&ab=3&42=4&length=5").has(s)', small],
  [
    "parameters-of",
    '(() => {\n    const q = new URLSearchParams(s);\n    return q.get("r") + "|" + q.has("q") + "|" + q.size;\n  })()',
    small,
  ],
  [
    "parameters-listed",
    '(() => {\n    let all = "";\n    for (const [key, value] of new URLSearchParams(s)) all += key + "=" + value + ";";\n    return all;\n  })()',
    small,
  ],
  [
    "parameters-keys-and-values",
    '(() => {\n    const q = new URLSearchParams(s);\n    return [...q.keys()].join() + ":" + [...q.values()].join();\n  })()',
    small,
  ],
  ["parameters-to-string", "new URLSearchParams(s).toString()", small],
  ["parameters-of-a-url", caught('new URL("http://host/x?" + s).searchParams.get("r")'), small],
  [
    "url-parts",
    caught(
      '(() => {\n        const u = new URL(s, "http://host/base/");\n        return u.pathname + "|" + u.search + "|" + u.hash;\n      })()',
    ),
    small,
  ],
  ["url-can-parse", '(URL as any).canParse(s, "http://host/")', small],
  ["url-parse", 'require("node:url").parse(s).pathname', small],
  ["url-resolve", 'require("node:url").resolve("http://host/a/b", s)', small],
  [
    "file-url-of",
    caught(
      '(() => {\n        const href: string = require("node:url").pathToFileURL(s, { windows: false }).href;\n        return href.slice(href.lastIndexOf("/"));\n      })()',
      "(error as any).code",
    ),
    small,
  ],
  [
    "file-url-on-windows",
    caught(
      '(() => {\n        const href: string = require("node:url").pathToFileURL(s, { windows: true }).href;\n        return href.slice(href.lastIndexOf("/"));\n      })()',
      "(error as any).code",
    ),
    small,
  ],
  [
    "path-of-file-url",
    caught('require("node:url").fileURLToPath("file:///" + encodeURI(s), { windows: false })', "(error as any).code"),
    small,
  ],
  ...["posix", "win32"].flatMap((platform): More["uses"] => [
    [`${platform}-basename`, path(platform, "basename(s)"), small],
    [`${platform}-basename-without`, path(platform, 'basename(s, ".txt")'), small],
    [`${platform}-basename-without-it`, path(platform, 'basename("dir/alpha beta gamma delta", s)'), small],
    [`${platform}-dirname`, path(platform, "dirname(s)"), small],
    [`${platform}-extname`, path(platform, "extname(s)"), small],
    [`${platform}-parse`, `JSON.stringify(${path(platform, "parse(s)")})`, small],
    [`${platform}-normalize`, path(platform, "normalize(s)"), small],
    [`${platform}-join`, path(platform, 'join(s, "x", s)'), small],
    [`${platform}-join-behind`, path(platform, 'join("x", s)'), small],
    [`${platform}-relative`, path(platform, 'relative(s, s + "/x")'), small],
    [`${platform}-relative-to`, path(platform, 'relative("/r/a/b", "/r/" + s)'), small],
    [`${platform}-resolve`, path(platform, `resolve(${platform === "posix" ? '"/r"' : '"C:\\\\r"'}, s)`), small],
    [`${platform}-is-absolute`, path(platform, "isAbsolute(s)"), small],
    [`${platform}-format`, path(platform, 'format({ dir: s, name: s, ext: ".e" })'), small],
    [`${platform}-to-namespaced`, path(platform, "toNamespacedPath(s)"), small],
    [
      `${platform}-parts-put-together`,
      `${path(platform, `join(${path(platform, "dirname(s)")}, ${path(platform, "basename(s)")})`)}`,
      small,
    ],
  ]),
  [
    "read-file",
    caught(
      'require("node:fs").readFileSync("/nowhere/" + s).length',
      '(error as any).code + " " + (error as any).path',
    ),
    small,
  ],
  [
    "read-file-by-it",
    caught('require("node:fs").readFileSync(s).length', '(error as any).code + " " + (error as any).path'),
    small,
  ],
  ["stat", 'require("node:fs").statSync(s, { throwIfNoEntry: false }) === undefined', small],
  ["access", caught('require("node:fs").accessSync(s)', "(error as any).code"), small],
  ["file-name", "Bun.file(s).name", small],
  ["glob-matches-it", 'new Bun.Glob("a*").match(s)', small],
  ["glob-of-it", caught('new Bun.Glob(s).match("alpha beta gamma delta")'), small],
  ...["utf8", "latin1", "ascii", "utf16le", "ucs2", "binary", "hex", "base64", "base64url"].flatMap(
    (encoding): More["uses"] => [
      [`buffer-from-${encoding}`, `Buffer.from(s, "${encoding}")`],
      [
        `buffer-write-${encoding}`,
        `(() => {\n    const b = Buffer.alloc(40);\n    return b.write(s, 3, "${encoding}") + ":" + b.toString("hex");\n  })()`,
      ],
      [`buffer-byte-length-${encoding}`, `Buffer.byteLength(s, "${encoding}")`],
    ],
  ),
  ["buffer-and-back", 'Buffer.from(s, "utf8").toString("utf8")'],
  ["buffer-equals-twin", 'Buffer.from(s).equals(Buffer.from(flatTwin(s + "")))'],
  [
    "encode-into-small",
    '(() => {\n    const view = new Uint8Array(7);\n    const { read, written } = new TextEncoder().encodeInto(s, view);\n    return read + ":" + written + ":" + view.join();\n  })()',
  ],
  ["pattern-replace-by-it", "hay.replace(/beta|42/g, s)", small],
  ["pattern-groups", "JSON.stringify(/^(.)(.*?)(.)$/s.exec(s))", small],
  ["pattern-named-groups", "JSON.stringify(/(?<first>[a-z]+)\\W*(?<second>\\w*)/.exec(s)?.groups)", small],
  ["pattern-unicode", "/^[\\p{L}\\p{N}\\s]*$/u.test(s)", small],
  ["pattern-ignoring-case", "/ALPHA|CAF\\u00c9|[A-F]+$/i.exec(s)?.index", small],
  [
    "pattern-global-last-index",
    '(() => {\n    const r = /[a-z]+/g;\n    let all = "";\n    for (let found = r.exec(s), n = 0; found && n < 20; found = r.exec(s), n++) all += found.index + ":" + r.lastIndex + ";";\n    return all;\n  })()',
    small,
  ],
];

const arounds: More["arounds"] = {
  "changed-between-two-uses": {
    body: `const first = show(USE);
  lookUpWhatWaits();
  const second = show(USE);
  return first === second ? first : first + " then " + second;`,
  },
  "changed-in-the-second-turn": {
    body: `let all = "";
  for (let i = 0; i < 3; i++) {
    if (i === 1) lookUpWhatWaits();
    all += show(USE) + ";";
  }
  return all;`,
  },
  "changed-in-a-callback": {
    body: `const first = show(USE);
  [0].forEach(lookUpWhatWaits);
  return first + show(USE);`,
  },
  "changed-in-a-handler": {
    body: `const first = show(USE);
  try {
    if (round >= 0) throw holder;
  } catch {
    lookUpWhatWaits();
  }
  return first + show(USE);`,
  },
  "changed-behind-a-wait": {
    isAsync: true,
    body: `const first = show(USE);
  await null;
  lookUpWhatWaits();
  await null;
  return first + show(USE);`,
  },
  "changed-between-reads-of-its-characters": {
    body: `const length = s.length;
  const unit = s.charCodeAt(length >> 1);
  const last = s[length - 1];
  lookUpWhatWaits();
  const answer = USE;
  return show(answer) + (s.length === length && s.charCodeAt(length >> 1) === unit && s[length - 1] === last ? "" : " moved");`,
  },
};

const more: More = { prelude, makers, uses, arounds };

const usesOfBoth = [...shared.uses.filter(name => name !== "switch"), ...uses.map(([name]) => name)];
const wideTexts = new Set(["wide", "wide-last", "cut-pair", "lone-halves"]);

export const dimensions = {
  texts: shared.texts,
  makers: Object.keys(makers),
  uses: usesOfBoth,
  arounds: [...shared.arounds, ...Object.keys(arounds)],
  homes: shared.homes,
};

/** A program of exactly these points, for a walk through the whole table. */
export const programOfPoints = (points: Point[]): string => programOf(points, more);

export function pointOf(random: Random, fixed: Partial<Point> = {}): Point {
  const maker = fixed.maker ?? random.pick(dimensions.makers);
  const isLater = maker.endsWith("--later");
  return {
    text: random.weighted(shared.texts.map(name => [wideTexts.has(name) ? 1 : 6, name] as const)),
    maker,
    use: random.chance(0.5) ? random.pick(uses)[0] : random.pick(usesOfBoth),
    around: isLater || random.chance(0.15) ? random.pick(Object.keys(arounds)) : random.pick(shared.arounds),
    home: random.weighted(shared.homes.map(name => [name === "argument" ? 4 : 1, name] as const)),
    size: random.weighted([
      [6, 0],
      [5, 60],
      [2, 1500],
      [1, 40000],
    ] as const),
    rounds: random.pick([2, 3, 40]),
    ...fixed,
  };
}

export function generate(random: Random): string {
  const points = Array.from({ length: random.between(5, 10) }, () => pointOf(random));
  return `// ${points.map(point => [point.text, point.maker, point.use, point.around, point.home, point.size].join("-")).join(" ")}\n${programOfPoints(points)}`;
}
