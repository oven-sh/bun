const hidden = new Function("v", "return v") as <V>(v: V) => V;

function kindOfText(text: string): number {
  if (text === "content_block_start") return 1;
  if (text === "content_block_delta") return 2;
  if (text === "content_block_stop") return 3;
  if (text === "message_start") return 4;
  if (text === "message_delta") return 5;
  if (text === "a text of forty characters, no more, yes") return 6;
  if (text === "très loin là-bas") return 7;
  if (text === "日本語のフォルダの名前") return 8;
  if (text !== "not this one either") return 0;
  return 9;
}
function kindOfValue(value: unknown): number {
  if (value === "content_block_start") return 1;
  if (value === "content_block_delta") return 2;
  if (value === "content_block_stop") return 3;
  if (value === "message_start") return 4;
  if (value === "message_delta") return 5;
  if (value === "a text of forty characters, no more, yes") return 6;
  if (value === "très loin là-bas") return 7;
  if (value === "日本語のフォルダの名前") return 8;
  if (value !== "not this one either") return 0;
  return 9;
}
function kindBySwitch(text: string): number {
  switch (text) {
    case "content_block_start": return 1;
    case "content_block_delta": return 2;
    case "content_block_stop": return 3;
    case "message_start": return 4;
    case "message_delta": return 5;
    default: return 0;
  }
}

function coldKindOfText(text: string): number {
  if (text === "content_block_start") return 1;
  if (text === "content_block_delta") return 2;
  if (text === "content_block_stop") return 3;
  if (text === "message_start") return 4;
  if (text === "message_delta") return 5;
  if (text === "a text of forty characters, no more, yes") return 6;
  if (text === "très loin là-bas") return 7;
  if (text === "日本語のフォルダの名前") return 8;
  if (text !== "not this one either") return 0;
  return 9;
}
function coldKindOfValue(value: unknown): number {
  if (value === "content_block_start") return 1;
  if (value === "content_block_delta") return 2;
  if (value === "content_block_stop") return 3;
  if (value === "message_start") return 4;
  if (value === "message_delta") return 5;
  if (value === "a text of forty characters, no more, yes") return 6;
  if (value === "très loin là-bas") return 7;
  if (value === "日本語のフォルダの名前") return 8;
  if (value !== "not this one either") return 0;
  return 9;
}
function coldKindBySwitch(text: string): number {
  switch (text) {
    case "content_block_start": return 1;
    case "content_block_delta": return 2;
    case "content_block_stop": return 3;
    case "message_start": return 4;
    case "message_delta": return 5;
    default: return 0;
  }
}

const literals = [
  "content_block_start", "content_block_delta", "content_block_stop", "message_start", "message_delta",
  "a text of forty characters, no more, yes", "très loin là-bas", "日本語のフォルダの名前", "not this one either",
];
function variantsOf(literal: string): string[] {
  const wide = hidden(("日" + literal).split("").join(""));
  return [
    literal,
    hidden(literal.split("").join("")),
    hidden(hidden(literal.slice(0, 5)) + hidden(literal.slice(5))),
    hidden(("<<" + literal + ">>").split("").join("")).slice(2, -2),
    wide.slice(1),
    hidden(Object.keys({ [wide.slice(1)]: 1 })[0]!),
    hidden(JSON.parse(JSON.stringify(literal))),
    hidden(literal.slice(0, -1) + "x"),
    hidden("x" + literal.slice(1)).split("").join(""),
    hidden(literal + "s"),
    hidden(literal.slice(1)),
    hidden(literal.toUpperCase()),
  ];
}
const subjects: string[] = [];
for (const literal of literals) subjects.push(...variantsOf(literal));
subjects.push("", "a", "message", "content_block");
const others: unknown[] = [undefined, null, 0, 19, true, {}, [], ["message_start"], Symbol("message_start"), 13n, { toString: () => "message_start" }, new String("message_start")];

let digest = 0;
const rounds = Number(process.argv[2] ?? 20);
for (let round = 0; round < rounds; round++) {
  for (const subject of subjects) digest = (digest * 31 + kindOfText(subject) * 100 + kindOfValue(subject) * 10 + kindBySwitch(subject)) | 0;
  for (const other of others) digest = (digest * 31 + kindOfValue(other)) | 0;
}
// The same functions, reached as values: nobody sees that they run in a loop.
const [textKind, valueKind, switchKind] = hidden([coldKindOfText, coldKindOfValue, coldKindBySwitch] as const);
for (let round = 0; round < rounds; round++) {
  for (const subject of subjects) digest = (digest * 31 + textKind(subject) * 100 + valueKind(subject) * 10 + switchKind(subject)) | 0;
  for (const other of others) digest = (digest * 31 + valueKind(other)) | 0;
}
// A module's top level runs once: there a comparison has its short form.
const once: boolean[] = [];
const v0 = variantsOf(literals[0]!), u0: unknown[] = v0;
once.push(v0[0]! === "content_block_start", u0[0] === "content_block_start", v0[0]! !== "content_block_delta");
once.push(v0[1]! === "content_block_start", u0[1] === "content_block_start", v0[1]! !== "content_block_delta");
once.push(v0[2]! === "content_block_start", u0[2] === "content_block_start", v0[2]! !== "content_block_delta");
once.push(v0[3]! === "content_block_start", u0[3] === "content_block_start", v0[3]! !== "content_block_delta");
once.push(v0[4]! === "content_block_start", u0[4] === "content_block_start", v0[4]! !== "content_block_delta");
once.push(v0[5]! === "content_block_start", u0[5] === "content_block_start", v0[5]! !== "content_block_delta");
once.push(v0[6]! === "content_block_start", u0[6] === "content_block_start", v0[6]! !== "content_block_delta");
once.push(v0[7]! === "content_block_start", u0[7] === "content_block_start", v0[7]! !== "content_block_delta");
once.push(v0[8]! === "content_block_start", u0[8] === "content_block_start", v0[8]! !== "content_block_delta");
once.push(v0[9]! === "content_block_start", u0[9] === "content_block_start", v0[9]! !== "content_block_delta");
once.push(v0[10]! === "content_block_start", u0[10] === "content_block_start", v0[10]! !== "content_block_delta");
once.push(v0[11]! === "content_block_start", u0[11] === "content_block_start", v0[11]! !== "content_block_delta");
const v1 = variantsOf(literals[1]!), u1: unknown[] = v1;
once.push(v1[0]! === "content_block_delta", u1[0] === "content_block_delta", v1[0]! !== "content_block_stop");
once.push(v1[1]! === "content_block_delta", u1[1] === "content_block_delta", v1[1]! !== "content_block_stop");
once.push(v1[2]! === "content_block_delta", u1[2] === "content_block_delta", v1[2]! !== "content_block_stop");
once.push(v1[3]! === "content_block_delta", u1[3] === "content_block_delta", v1[3]! !== "content_block_stop");
once.push(v1[4]! === "content_block_delta", u1[4] === "content_block_delta", v1[4]! !== "content_block_stop");
once.push(v1[5]! === "content_block_delta", u1[5] === "content_block_delta", v1[5]! !== "content_block_stop");
once.push(v1[6]! === "content_block_delta", u1[6] === "content_block_delta", v1[6]! !== "content_block_stop");
once.push(v1[7]! === "content_block_delta", u1[7] === "content_block_delta", v1[7]! !== "content_block_stop");
once.push(v1[8]! === "content_block_delta", u1[8] === "content_block_delta", v1[8]! !== "content_block_stop");
once.push(v1[9]! === "content_block_delta", u1[9] === "content_block_delta", v1[9]! !== "content_block_stop");
once.push(v1[10]! === "content_block_delta", u1[10] === "content_block_delta", v1[10]! !== "content_block_stop");
once.push(v1[11]! === "content_block_delta", u1[11] === "content_block_delta", v1[11]! !== "content_block_stop");
const v2 = variantsOf(literals[2]!), u2: unknown[] = v2;
once.push(v2[0]! === "content_block_stop", u2[0] === "content_block_stop", v2[0]! !== "message_start");
once.push(v2[1]! === "content_block_stop", u2[1] === "content_block_stop", v2[1]! !== "message_start");
once.push(v2[2]! === "content_block_stop", u2[2] === "content_block_stop", v2[2]! !== "message_start");
once.push(v2[3]! === "content_block_stop", u2[3] === "content_block_stop", v2[3]! !== "message_start");
once.push(v2[4]! === "content_block_stop", u2[4] === "content_block_stop", v2[4]! !== "message_start");
once.push(v2[5]! === "content_block_stop", u2[5] === "content_block_stop", v2[5]! !== "message_start");
once.push(v2[6]! === "content_block_stop", u2[6] === "content_block_stop", v2[6]! !== "message_start");
once.push(v2[7]! === "content_block_stop", u2[7] === "content_block_stop", v2[7]! !== "message_start");
once.push(v2[8]! === "content_block_stop", u2[8] === "content_block_stop", v2[8]! !== "message_start");
once.push(v2[9]! === "content_block_stop", u2[9] === "content_block_stop", v2[9]! !== "message_start");
once.push(v2[10]! === "content_block_stop", u2[10] === "content_block_stop", v2[10]! !== "message_start");
once.push(v2[11]! === "content_block_stop", u2[11] === "content_block_stop", v2[11]! !== "message_start");
const v3 = variantsOf(literals[3]!), u3: unknown[] = v3;
once.push(v3[0]! === "message_start", u3[0] === "message_start", v3[0]! !== "message_delta");
once.push(v3[1]! === "message_start", u3[1] === "message_start", v3[1]! !== "message_delta");
once.push(v3[2]! === "message_start", u3[2] === "message_start", v3[2]! !== "message_delta");
once.push(v3[3]! === "message_start", u3[3] === "message_start", v3[3]! !== "message_delta");
once.push(v3[4]! === "message_start", u3[4] === "message_start", v3[4]! !== "message_delta");
once.push(v3[5]! === "message_start", u3[5] === "message_start", v3[5]! !== "message_delta");
once.push(v3[6]! === "message_start", u3[6] === "message_start", v3[6]! !== "message_delta");
once.push(v3[7]! === "message_start", u3[7] === "message_start", v3[7]! !== "message_delta");
once.push(v3[8]! === "message_start", u3[8] === "message_start", v3[8]! !== "message_delta");
once.push(v3[9]! === "message_start", u3[9] === "message_start", v3[9]! !== "message_delta");
once.push(v3[10]! === "message_start", u3[10] === "message_start", v3[10]! !== "message_delta");
once.push(v3[11]! === "message_start", u3[11] === "message_start", v3[11]! !== "message_delta");
const v4 = variantsOf(literals[4]!), u4: unknown[] = v4;
once.push(v4[0]! === "message_delta", u4[0] === "message_delta", v4[0]! !== "a text of forty characters, no more, yes");
once.push(v4[1]! === "message_delta", u4[1] === "message_delta", v4[1]! !== "a text of forty characters, no more, yes");
once.push(v4[2]! === "message_delta", u4[2] === "message_delta", v4[2]! !== "a text of forty characters, no more, yes");
once.push(v4[3]! === "message_delta", u4[3] === "message_delta", v4[3]! !== "a text of forty characters, no more, yes");
once.push(v4[4]! === "message_delta", u4[4] === "message_delta", v4[4]! !== "a text of forty characters, no more, yes");
once.push(v4[5]! === "message_delta", u4[5] === "message_delta", v4[5]! !== "a text of forty characters, no more, yes");
once.push(v4[6]! === "message_delta", u4[6] === "message_delta", v4[6]! !== "a text of forty characters, no more, yes");
once.push(v4[7]! === "message_delta", u4[7] === "message_delta", v4[7]! !== "a text of forty characters, no more, yes");
once.push(v4[8]! === "message_delta", u4[8] === "message_delta", v4[8]! !== "a text of forty characters, no more, yes");
once.push(v4[9]! === "message_delta", u4[9] === "message_delta", v4[9]! !== "a text of forty characters, no more, yes");
once.push(v4[10]! === "message_delta", u4[10] === "message_delta", v4[10]! !== "a text of forty characters, no more, yes");
once.push(v4[11]! === "message_delta", u4[11] === "message_delta", v4[11]! !== "a text of forty characters, no more, yes");
const v5 = variantsOf(literals[5]!), u5: unknown[] = v5;
once.push(v5[0]! === "a text of forty characters, no more, yes", u5[0] === "a text of forty characters, no more, yes", v5[0]! !== "très loin là-bas");
once.push(v5[1]! === "a text of forty characters, no more, yes", u5[1] === "a text of forty characters, no more, yes", v5[1]! !== "très loin là-bas");
once.push(v5[2]! === "a text of forty characters, no more, yes", u5[2] === "a text of forty characters, no more, yes", v5[2]! !== "très loin là-bas");
once.push(v5[3]! === "a text of forty characters, no more, yes", u5[3] === "a text of forty characters, no more, yes", v5[3]! !== "très loin là-bas");
once.push(v5[4]! === "a text of forty characters, no more, yes", u5[4] === "a text of forty characters, no more, yes", v5[4]! !== "très loin là-bas");
once.push(v5[5]! === "a text of forty characters, no more, yes", u5[5] === "a text of forty characters, no more, yes", v5[5]! !== "très loin là-bas");
once.push(v5[6]! === "a text of forty characters, no more, yes", u5[6] === "a text of forty characters, no more, yes", v5[6]! !== "très loin là-bas");
once.push(v5[7]! === "a text of forty characters, no more, yes", u5[7] === "a text of forty characters, no more, yes", v5[7]! !== "très loin là-bas");
once.push(v5[8]! === "a text of forty characters, no more, yes", u5[8] === "a text of forty characters, no more, yes", v5[8]! !== "très loin là-bas");
once.push(v5[9]! === "a text of forty characters, no more, yes", u5[9] === "a text of forty characters, no more, yes", v5[9]! !== "très loin là-bas");
once.push(v5[10]! === "a text of forty characters, no more, yes", u5[10] === "a text of forty characters, no more, yes", v5[10]! !== "très loin là-bas");
once.push(v5[11]! === "a text of forty characters, no more, yes", u5[11] === "a text of forty characters, no more, yes", v5[11]! !== "très loin là-bas");
const v6 = variantsOf(literals[6]!), u6: unknown[] = v6;
once.push(v6[0]! === "très loin là-bas", u6[0] === "très loin là-bas", v6[0]! !== "日本語のフォルダの名前");
once.push(v6[1]! === "très loin là-bas", u6[1] === "très loin là-bas", v6[1]! !== "日本語のフォルダの名前");
once.push(v6[2]! === "très loin là-bas", u6[2] === "très loin là-bas", v6[2]! !== "日本語のフォルダの名前");
once.push(v6[3]! === "très loin là-bas", u6[3] === "très loin là-bas", v6[3]! !== "日本語のフォルダの名前");
once.push(v6[4]! === "très loin là-bas", u6[4] === "très loin là-bas", v6[4]! !== "日本語のフォルダの名前");
once.push(v6[5]! === "très loin là-bas", u6[5] === "très loin là-bas", v6[5]! !== "日本語のフォルダの名前");
once.push(v6[6]! === "très loin là-bas", u6[6] === "très loin là-bas", v6[6]! !== "日本語のフォルダの名前");
once.push(v6[7]! === "très loin là-bas", u6[7] === "très loin là-bas", v6[7]! !== "日本語のフォルダの名前");
once.push(v6[8]! === "très loin là-bas", u6[8] === "très loin là-bas", v6[8]! !== "日本語のフォルダの名前");
once.push(v6[9]! === "très loin là-bas", u6[9] === "très loin là-bas", v6[9]! !== "日本語のフォルダの名前");
once.push(v6[10]! === "très loin là-bas", u6[10] === "très loin là-bas", v6[10]! !== "日本語のフォルダの名前");
once.push(v6[11]! === "très loin là-bas", u6[11] === "très loin là-bas", v6[11]! !== "日本語のフォルダの名前");
const v7 = variantsOf(literals[7]!), u7: unknown[] = v7;
once.push(v7[0]! === "日本語のフォルダの名前", u7[0] === "日本語のフォルダの名前", v7[0]! !== "not this one either");
once.push(v7[1]! === "日本語のフォルダの名前", u7[1] === "日本語のフォルダの名前", v7[1]! !== "not this one either");
once.push(v7[2]! === "日本語のフォルダの名前", u7[2] === "日本語のフォルダの名前", v7[2]! !== "not this one either");
once.push(v7[3]! === "日本語のフォルダの名前", u7[3] === "日本語のフォルダの名前", v7[3]! !== "not this one either");
once.push(v7[4]! === "日本語のフォルダの名前", u7[4] === "日本語のフォルダの名前", v7[4]! !== "not this one either");
once.push(v7[5]! === "日本語のフォルダの名前", u7[5] === "日本語のフォルダの名前", v7[5]! !== "not this one either");
once.push(v7[6]! === "日本語のフォルダの名前", u7[6] === "日本語のフォルダの名前", v7[6]! !== "not this one either");
once.push(v7[7]! === "日本語のフォルダの名前", u7[7] === "日本語のフォルダの名前", v7[7]! !== "not this one either");
once.push(v7[8]! === "日本語のフォルダの名前", u7[8] === "日本語のフォルダの名前", v7[8]! !== "not this one either");
once.push(v7[9]! === "日本語のフォルダの名前", u7[9] === "日本語のフォルダの名前", v7[9]! !== "not this one either");
once.push(v7[10]! === "日本語のフォルダの名前", u7[10] === "日本語のフォルダの名前", v7[10]! !== "not this one either");
once.push(v7[11]! === "日本語のフォルダの名前", u7[11] === "日本語のフォルダの名前", v7[11]! !== "not this one either");
const v8 = variantsOf(literals[8]!), u8: unknown[] = v8;
once.push(v8[0]! === "not this one either", u8[0] === "not this one either", v8[0]! !== "content_block_start");
once.push(v8[1]! === "not this one either", u8[1] === "not this one either", v8[1]! !== "content_block_start");
once.push(v8[2]! === "not this one either", u8[2] === "not this one either", v8[2]! !== "content_block_start");
once.push(v8[3]! === "not this one either", u8[3] === "not this one either", v8[3]! !== "content_block_start");
once.push(v8[4]! === "not this one either", u8[4] === "not this one either", v8[4]! !== "content_block_start");
once.push(v8[5]! === "not this one either", u8[5] === "not this one either", v8[5]! !== "content_block_start");
once.push(v8[6]! === "not this one either", u8[6] === "not this one either", v8[6]! !== "content_block_start");
once.push(v8[7]! === "not this one either", u8[7] === "not this one either", v8[7]! !== "content_block_start");
once.push(v8[8]! === "not this one either", u8[8] === "not this one either", v8[8]! !== "content_block_start");
once.push(v8[9]! === "not this one either", u8[9] === "not this one either", v8[9]! !== "content_block_start");
once.push(v8[10]! === "not this one either", u8[10] === "not this one either", v8[10]! !== "content_block_start");
once.push(v8[11]! === "not this one either", u8[11] === "not this one either", v8[11]! !== "content_block_start");
once.push(others[0] === "content_block_start", others[7] === "message_start", others[11] === "message_start", hidden<string>("") === "content_block_start");
console.log(once.map(Number).join(""));
console.log(digest, subjects.map(kindOfText).join(""), others.map(kindOfValue).join(""));
