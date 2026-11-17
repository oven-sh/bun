// `text.endsWith(end)` and `text.lastIndexOf(part, from)` by closed calls, over every pair of kinds of text: flat and narrow, flat and wide, joined, cut out of another, empty, one character.
function endsAny(text: any, end: unknown, length?: unknown): unknown { return length === undefined ? text.endsWith(end) : text.endsWith(end, length) }
function lastAny(text: any, part: unknown, from?: unknown): unknown { return from === undefined ? text.lastIndexOf(part) : text.lastIndexOf(part, from) }
const long = "/home/user/project/src/compiler/checker.d.ts"
let turn = 0
const kinds: [string, () => unknown][] = [
  ["empty", () => ""],
  ["one character", () => "/"],
  ["narrow", () => long],
  ["narrow end", () => ".d.ts"],
  ["narrow, not there", () => ".tsx"],
  ["the same text", () => "/home/user/project/src/compiler/checker.d.ts"],
  ["longer than the text", () => long + long],
  ["wide", () => "/home/你好/src/αβ.d.ts"],
  ["wide end", () => "αβ.d.ts"],
  ["wide character", () => "好"],
  ["narrow characters above 127", () => "café/é.ts"],
  ["joined", () => "/home/user/" + String(turn++ % 3) + "/src/compiler/checker.d.ts"],
  ["joined end", () => "." + ["d", "x"][turn++ % 2] + ".ts"],
  ["cut out of another", () => (long + long).slice(3, 47)],
  ["cut end", () => long.slice(-5)],
  ["repeated", () => "ab".repeat(20)],
  ["part of the repeated", () => "ba"],
  ["a number", () => 5],
  ["undefined", () => undefined],
  ["null", () => null],
  ["an object with toString", () => ({ toString() { return ".ts" } })],
]
const places: unknown[] = [undefined, 0, 1, 5, 20, 43, 44, 45, 1000, -1, -1000, 2.5, NaN, Infinity, -Infinity, "7", null]
for (let round = 0; round < 3; round++) {
  for (const [name, text] of kinds) {
    const value = text()
    if (typeof value !== "string") continue
    const lines: string[] = []
    for (const [, other] of kinds) {
      const part = other()
      const answers: unknown[] = []
      for (const place of places) answers.push(endsAny(value, part, place) ? 1 : 0, lastAny(value, part, place))
      lines.push(answers.join(","))
    }
    console.log(round, name + ":", lines.join(" | "))
  }
}
for (const bad of [/x/, Symbol("s")]) {
  for (const ask of [endsAny, lastAny]) {
    try { console.log(String(ask(long, bad))) } catch (error) { console.log((error as Error).constructor.name) }
  }
}
