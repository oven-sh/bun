const hidden = new Function("v", "return v") as <V>(v: V) => V;

function write(value: unknown, out: string[]): void {
  if (value === null || typeof value !== "object") {
    out.push(JSON.stringify(value) ?? "null");
    return;
  }
  if (Array.isArray(value)) {
    out.push("[");
    value.forEach((item, index) => {
      if (index > 0) out.push(",");
      write(item, out);
    });
    out.push("]");
    return;
  }
  out.push("{");
  let first = true;
  for (const key of Object.keys(value).sort()) {
    const child = (value as { [key: string]: unknown })[key];
    if (child === undefined) continue;
    if (!first) out.push(",");
    first = false;
    out.push(JSON.stringify(key), ":");
    write(child, out);
  }
  out.push("}");
}
function canonical(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join("");
}
function withCommas(pieces: string[]): string { return pieces.join(","); }
function withDefault(pieces: string[]): string { return pieces.join(); }
function withArrow(pieces: string[]): string { return pieces.join(" -> "); }
function withWide(pieces: string[]): string { return pieces.join("・"); }
function withText(pieces: string[], between: string): string { return pieces.join(between); }
function mixed(pieces: (string | number | null | undefined)[]): string { return pieces.join("/"); }

const value = hidden({
  model: "a-model-name", max_tokens: 32000, stream: true, temperature: 1,
  system: [{ type: "text", text: "You are a program that answers." }, { type: "text", text: "Second block, with a “quote” and a tab\t." }],
  messages: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: "message number " + i + " ".repeat(i) + "é".repeat(i % 3) }] })),
  tools: Array.from({ length: 8 }, (_, i) => ({ name: "tool_" + i, description: "does thing " + i, input_schema: { type: "object", properties: { path: { type: "string" }, limit: { type: "number" } }, required: ["path"] } })),
});
const lists: string[][] = [
  [], ["only"], ["a", "b"], ["", "", ""], ["x".repeat(40), "y".repeat(17), "z"], ["日本", "語"], ["a", "日", "b"],
  [hidden("ro") + hidden("pe"), hidden("0123456789").slice(2, 7), "flat"], Array.from({ length: 300 }, (_, i) => String(i)),
  [hidden("x".repeat(3000)) + hidden("y".repeat(3000)), "z".repeat(5000), "w".repeat(4000)],
];

let digest = 0;
function note(text: string): void {
  digest = (digest * 31 + text.length) | 0;
  for (let i = 0; i < text.length; i += 7) digest = (digest * 31 + text.charCodeAt(i)) | 0;
}
const rounds = Number(process.argv[2] ?? 5);
for (let round = 0; round < rounds; round++) {
  note(canonical(value));
  for (const list of lists) {
    note(withCommas(list)); note(withDefault(list)); note(withArrow(list)); note(withWide(list)); note(withText(list, hidden(""))); note(withText(list, hidden("<") + hidden(">")));
  }
  note(mixed(["a", 1, null, undefined, "b", -7]));
  note(mixed(hidden(["a", , "b"] as string[])));
}
console.log(digest, canonical(hidden({ b: [1, "two", null, { c: undefined, d: false }], a: "é" })), withCommas(hidden(["p", "q"])), withDefault(hidden(["p", "q"])));
try {
  const big = "x".repeat(1 << 28);
  console.log(withText([big, big, big, big, big, big, big, big, big], big.slice(0, 1 << 20)).length);
} catch (error) {
  console.log((error as Error).name, (error as Error).message);
}
