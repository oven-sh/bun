type Level = "low" | "mid" | "high";
interface Row {
  level: Level;
  n: number;
}

function worth(level: Level): number {
  switch (level) {
    case "low":
      return 10;
    case "mid":
      return 20;
    case "high":
      return 30;
  }
}

function name(level: Level): string {
  return level === "low" ? "L" : level === "mid" ? "M" : level === "high" ? "H" : "none of them: " + level;
}

function keep(row: Row, level: Level): Level {
  row.level = level;
  return row.level;
}

type Mode = "off" | "read" | "write";
let kept: "read" | "write" = "read";
let last: Level = "low";

function keepMode(mode: Mode): string {
  if (mode !== "off") kept = mode;
  switch (kept) {
    case "read":
      return "R";
    case "write":
      return "W";
  }
}

function keepLast(value: any): number {
  last = value;
  return worth(last);
}

class Holder {
  level: Level = "mid";
  take(value: unknown): string {
    this.level = value as Level;
    return name(this.level);
  }
}
const holder = new Holder();

const texts: string[] = [
  "low",
  "mid",
  "high",
  "other",
  "",
  "lo" + "w".repeat(1),
  "xhigh".slice(1),
  "MID".toLowerCase(),
];
const cast = texts.map(text => text as Level);
const parsed: Row[] = JSON.parse(
  '[{"level":"low","n":1},{"level":"mid","n":2},{"level":"none","n":3},{"level":"high","n":4}]',
);
const byNumber = new Map<number, Level>(cast.map((level, index) => [index, level]));
const loose: any[] = ["high", 7, null, undefined, { toString: () => "low" }, "mid"];
const row: Row = { level: "low", n: 0 };
const counts: Record<Level, number> = { low: 0, mid: 0, high: 0 };

for (let round = 0; round < 3; round++) {
  const lines: string[] = [];
  for (const level of cast) lines.push(`${name(level)} ${worth(level)} ${keep(row, level)} ${typeof row.level}`);
  for (const each of parsed) lines.push(`${name(each.level)} ${worth(each.level)} ${each.level === row.level}`);
  for (let index = 0; index < 9; index++) {
    const level = byNumber.get(index);
    lines.push(level === undefined ? "absent" : `${name(level)} ${worth(level)}`);
  }
  for (const value of loose) {
    const level = value as Level;
    lines.push(`${level === "high"} ${level == "low"} ${worth(level)} ${String(keep(row, level))}`);
  }
  for (const text of texts)
    lines.push(`${keepMode(text as Mode)} ${kept} ${keepLast(text)} ${last} ${holder.take(text)} ${holder.level}`);
  for (const value of loose)
    lines.push(
      `${keepMode(value)} ${String(kept)} ${keepLast(value)} ${String(last)} ${holder.take(value)} ${String(holder.level)}`,
    );
  for (const level of cast) counts[level] = (counts[level] ?? 0) + 1;
  console.log(lines.join("\n"));
}
console.log(JSON.stringify(counts), JSON.stringify(row));
