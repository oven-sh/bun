function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

type Mode = "on" | "off";
type Level = 1 | 2 | 3;

enum Color {
  Red,
  Green,
  Blue,
}

enum Word {
  Yes = "yes",
  No = "no",
}

function modeNumber(mode: Mode): number {
  switch (mode) {
    case "on":
      return 1;
    case "off":
      return 0;
  }
}

function modeByIf(mode: Mode): string {
  if (mode === "on") return "is on";
  return "must be off: " + mode.length;
}

function modeTable(mode: Mode): number {
  const table: Record<Mode, number> = { on: 10, off: 20 };
  return table[mode] + 1;
}

function levelName(level: Level): string {
  switch (level) {
    case 1:
      return "low";
    case 2:
      return "middle";
    case 3:
      return "high";
  }
}

function levelIndex(level: Level): string {
  return ["none", "low", "middle", "high"][level].toUpperCase();
}

function colorName(color: Color): string {
  switch (color) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    case Color.Blue:
      return "blue";
  }
}

function colorReverse(color: Color): string {
  return Color[color] + "!";
}

function colorMath(color: Color): number {
  return color * 2 + 1;
}

function wordSize(word: Word): number {
  return word === Word.Yes ? 3 : word.length;
}

function flag(on: boolean): number {
  return on ? 1 : 0;
}

function flagSwitch(on: boolean): string {
  switch (on) {
    case true:
      return "true";
    case false:
      return "false";
  }
}

function onlyTrue(on: true): string {
  return on === true ? "true" : "never";
}

function honest(label: string): void {
  console.log(label, modeNumber("on"), modeNumber("off"), modeByIf("off"), modeTable("on"), levelName(2), levelIndex(3), colorName(Color.Blue), colorReverse(Color.Red), colorMath(Color.Green), wordSize(Word.No), flag(true), flagSwitch(false), onlyTrue(true));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += modeNumber(i & 1 ? "on" : "off") + modeTable("on") + levelName(((i % 3) + 1) as Level).length + colorName((i % 3) as Color).length + colorMath(Color.Blue) + flag(i % 2 === 0);
console.log("2000 honest rounds", warm);

const values = ["'on'", "'off'", "'ON'", "'o' + 'n'", "new String('on')", "''", "1", "2", "3", "0", "4", "-1", "1.5", "-0", "NaN", "'1'", "1n", "true", "false", "null", "undefined", "{}", "['on']", "[1]", "{ toString() { note('toString'); return 'on'; }, valueOf() { note('valueOf'); return 1; } }", "'yes'", "'constructor'", "'__proto__'", "Symbol()"];

for (const text of values) {
  attempt("colorName " + text, () => colorName(hidden(text)));
  attempt("colorReverse " + text, () => colorReverse(hidden(text)));
  attempt("colorMath " + text, () => colorMath(hidden(text)));
  attempt("wordSize " + text, () => wordSize(hidden(text)));
  attempt("flag " + text, () => flag(hidden(text)));
  attempt("flagSwitch " + text, () => flagSwitch(hidden(text)));
  attempt("onlyTrue " + text, () => onlyTrue(hidden(text)));
}

honest("honest after");
