// The last three lines evaluate text and make a ShadowRealm, so JSON.parse may have been replaced by the time it is called. `JSON.parse(text) as T` still answers what the plain parse answers.
// Records of 7 declared fields and as many undeclared keys, four deep, in arrays, tuples and dictionaries, are parsed by `JSON.parse(text) as T` while the collector runs as often as it can be made to.
interface Level1 { f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null }
interface Level2 { f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; kid: Level1 }
interface Level3 { f0: string; f1: number; f2: string; kid: Level2; f4: string[]; f5: number; f6: string | null }
interface Level4 { kid: Level3; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null }
const width: number = 7;
const lastOf = (leaf: Level1): string => String(leaf.f6);
interface Holder { list: Level4[]; pair: [Level4, Level3, string]; byName: Record<string, Level4>; one: Level4; rows: Level2[][] }

const plainParse: (text: string) => any = JSON.parse;
const few = width > 7;
let seed = 7;
let serial = 0;
let recordsBuilt = 0;

function random(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % limit;
}

function longText(): string {
  return '"text number ' + ++serial + ' is too long for a cache of short strings"';
}

function declaredValue(at: number): string {
  switch (width === 1 ? 0 : at % 7) {
    case 0:
    case 2:
      return longText();
    case 1:
      return String(++serial * 3);
    case 3:
      return at % 2 ? "true" : "false";
    case 4:
      return "[" + longText() + "," + longText() + "]";
    case 5:
      return ++serial + ".5";
    default:
      return ++serial % 2 ? "null" : longText();
  }
}

function undeclaredValue(at: number): string {
  switch (at % 5) {
    case 0:
      return longText();
    case 1:
      return '{"a":' + longText() + ',"b":[' + longText() + ',{"c":' + longText() + "}]}";
    case 2:
      return String(++serial);
    case 3:
      return "[" + longText() + ",[" + longText() + "],{}]";
    default:
      return '"s' + (at % 3) + '"';
  }
}

function kidAt(level: number): number {
  return level === 4 ? 0 : level === 3 ? width >> 1 : width - 1;
}

function record(level: number, undeclared: number, shuffled: boolean): string {
  const number = ++recordsBuilt;
  const marked = level > 1 && kidAt(level) === width - 1 ? width - 2 : width - 1;
  const declared: string[] = [];
  for (let at = 0; at < width; at++) {
    if (level > 1 && at === kidAt(level)) declared.push('"kid":' + record(level - 1, undeclared, shuffled));
    else if (at === marked) declared.push("\u0001" + number + '\u0002"f' + at + '"\u0003:' + declaredValue(at) + "\u0004");
    else declared.push('"f' + at + '":' + declaredValue(at));
  }
  const others: string[] = [];
  if (undeclared) for (let at = 0; at < width; at++) others.push('"u' + at + '":' + undeclaredValue(at));
  let members: string[] = [];
  if (undeclared === 1) members = [...declared, ...others];
  else if (undeclared === 2) members = [...others, ...declared];
  else for (let at = 0; at < declared.length || at < others.length; at++) members.push(...declared.slice(at, at + 1), ...others.slice(at, at + 1));
  if (shuffled) {
    for (let at = members.length - 1; at > 0; at--) {
      const other = random(at + 1);
      const held = members[at];
      members[at] = members[other];
      members[other] = held;
    }
  }
  return "{" + members.join(",") + "}";
}

function holder(undeclared: number, shuffled: boolean): string {
  recordsBuilt = 0;
  const level4 = () => record(4, undeclared, shuffled);
  const list = few ? [level4()] : [level4(), level4()];
  const pair = [level4(), record(3, undeclared, shuffled), longText()];
  const byName = few ? ['"a name that is long enough to be no short string ' + ++serial + '":' + level4()] : ['"a name that is long enough to be no short string ' + ++serial + '":' + level4(), '"n":' + level4()];
  const rows = few ? [[], [record(2, undeclared, shuffled)]] : [[record(2, undeclared, shuffled)], [], [record(2, undeclared, shuffled), record(2, undeclared, shuffled)]];
  return '{"list":[' + list.join(",") + '],"pair":[' + pair.join(",") + '],"byName":{' + byName.join(",") + '},"one":' + level4() + ',"rows":[' + rows.map(row => "[" + row.join(",") + "]").join(",") + "]}";
}

const marks = /\u0001[0-9]+\u0002|[\u0003\u0004]/g;

function withFault(marked: string, number: number, kind: string): string {
  const start = marked.indexOf("\u0001" + number + "\u0002");
  if (start < 0) return "";
  const keyStart = marked.indexOf("\u0002", start) + 1;
  const keyEnd = marked.indexOf("\u0003", keyStart);
  const end = marked.indexOf("\u0004", keyEnd);
  const key = marked.slice(keyStart, keyEnd);
  const value = marked.slice(keyEnd + 2, end);
  let member = "";
  if (kind === "misfit") member = key + ":" + (value[0] === "[" || value[0] === '"' ? "{}" : "[" + value + "]");
  else if (kind === "missing") member = '"other":' + value;
  else if (kind === "token") member = key + ":" + value + "@";
  else if (kind === "end") return marked.slice(0, end).replace(marks, "");
  else if (kind === "escaped key") member = '"\\u0066' + key.slice(2) + ":" + value;
  else if (kind === "twice") member = key + ":" + value + "," + key + ":" + value;
  else member = '"__proto__":{"p":' + value + "}," + key + ":" + value + ',"7":' + value + ',"":' + value;
  return (marked.slice(0, start) + member + marked.slice(end)).replace(marks, "");
}

function spaced(text: string): string {
  const pieces: string[] = [];
  let from = 0;
  let inString = false;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if (inString) {
      if (code === 92) at++;
      else if (code === 34) inString = false;
    } else if (code === 34) inString = true;
    else if (code === 44 || code === 58 || code === 123 || code === 91 || code === 125 || code === 93) {
      pieces.push(text.slice(from, at), at % 3 ? " " : "\n\t", text[at], at % 2 ? "\r\n" : " ");
      from = at + 1;
    }
  }
  pieces.push(text.slice(from));
  return pieces.join("");
}

function probe(value: Holder): number {
  let found = value.one.kid.kid.kid.f0.length + value.pair[2].charCodeAt(13) + lastOf(value.pair[1].kid.kid).length;
  for (const item of value.list) found += item.kid.kid.kid.f0.charCodeAt(14) + lastOf(item.kid.kid.kid).length;
  for (const name in value.byName) found += name.length + value.byName[name].kid.kid.kid.f0.charCodeAt(13);
  for (const row of value.rows) for (const item of row) found += item.kid.f0.charCodeAt(14);
  return found;
}

const kept: { value: Holder; written: string; probed: number }[] = [];

function keptStillStand(): string {
  let lost = 0;
  for (const entry of kept) if (JSON.stringify(entry.value) !== entry.written || probe(entry.value) !== entry.probed) lost++;
  const checked = kept.length;
  if (checked > 3) kept.splice(0, checked - 3);
  return lost + " of " + checked + " kept ones lost";
}

function section(label: string, undeclared: number, shuffled: boolean, withSpaces: boolean): void {
  const marked = holder(undeclared, shuffled);
  const records = recordsBuilt;
  const compact = marked.replace(marks, "");
  const text = withSpaces ? spaced(compact) : compact;
  let different = 0;
  const probed = probe(plainParse(compact));
  for (let round = 0; round < 2; round++) {
    const value = JSON.parse(text) as Holder;
    if (JSON.stringify(value) !== compact || probe(value) !== probed) different++;
    kept.push({ value, written: compact, probed });
  }
  console.log(label + ": " + different + " differ, " + keptStillStand());
  for (const kind of few ? ["misfit", "end", "escaped key", "odd keys"] : ["misfit", "missing", "token", "end", "escaped key", "twice", "odd keys"]) {
    let texts = 0;
    let values = 0;
    let syntaxErrors = 0;
    different = 0;
    for (let number = records; number > 0; number -= records >> 1) {
      let faulty = withFault(marked, number, kind);
      if (faulty === "") continue;
      if (withSpaces) faulty = spaced(faulty);
      texts++;
      let expected = "";
      let plain: any;
      try {
        plain = plainParse(faulty);
        expected = JSON.stringify(plain);
      } catch (error: any) {
        expected = error.name + ": " + error.message;
      }
      try {
        const value = JSON.parse(faulty) as Holder;
        values++;
        if (JSON.stringify(value) !== expected || probe(value) !== probe(plain)) different++;
        if (texts === 1) kept.push({ value, written: expected, probed: probe(plain) });
      } catch (error: any) {
        if (error.name === "SyntaxError") {
          syntaxErrors++;
          if (error.name + ": " + error.message !== expected) different++;
        } else different++;
      }
    }
    console.log(label + ", " + kind + ": " + texts + " texts: " + values + " values, " + syntaxErrors + " syntax errors, " + different + " differ, " + keptStillStand());
  }
}

const sections: [string, number, boolean, boolean][] = [
  ["declared order", 0, false, false],
  ["shuffled", 0, true, false],
  ["spaced", 0, false, true],
  ["undeclared keys behind", 1, false, false],
  ["undeclared keys in front", 2, false, false],
  ["undeclared keys between", 3, false, false],
  ["undeclared keys, shuffled", 3, true, false],
  ["undeclared keys, shuffled and spaced", 3, true, true],
];
sections.forEach(([label, undeclared, shuffled, withSpaces], at) => {
  if (!few || at === 0 || at === 1 || at === 5 || at === 7) section(label, undeclared, shuffled, withSpaces);
});
const never = process.argv.length > 99;
console.log(Function("return " + (never ? "x" : "1"))());
new ShadowRealm().importValue("node:path", "sep").then(() => console.log("settled"), () => console.log("settled"));
