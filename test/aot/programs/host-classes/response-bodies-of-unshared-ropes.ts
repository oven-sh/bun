// A concatenation that nothing but one `new Response(text, { .. })` can reach is written as UTF-8 for the body without being flattened into a string. Whatever else may hold the text keeps today's road.
const filler = "0123456789abcdef".repeat(20);
const init = (kind: string) => ({ "Content-Type": kind });
function direct(title: string, text: string): Response {
  return new Response(`<h1>${title}</h1><p>${text}</p>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function page(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function layout(title: string, content: string): string {
  return `<title>${title}</title><main>${content}</main>`;
}
function item(text: string): string {
  return `<li>${text}</li>`;
}
function throughHelpers(title: string, texts: string[]): Response {
  return page(layout(title, `<ul>${texts.map(item).join("")}</ul>`));
}
function chosen(title: string, text: string, isShort: boolean): Response {
  const body = isShort ? `<p>${text}</p>` : `<h1>${title}</h1><p>${text}</p><p>${text}</p>`;
  return new Response(body, { headers: { "Content-Type": "text/html" } });
}
function readAfterwards(title: string, text: string): [Response, number] {
  const body = `<h1>${title}</h1><p>${text}</p>`;
  return [new Response(body, { status: 200 }), body.length];
}
const kept = new Map<string, string>();
function keptInAMap(title: string, text: string): Response {
  const body = `<h1>${title}</h1><p>${text}</p>`;
  kept.set(title, body);
  return new Response(body, { status: 200 });
}
function cached(title: string): string {
  return kept.get(title) ?? "";
}
function fromTheMap(title: string): Response {
  return new Response(cached(title), { status: 200 });
}
function withNothingAdded(title: string, more: string): Response {
  return new Response(cached(title) + more, { status: 200 });
}
function inALoop(title: string, text: string): Response[] {
  const body = `<h1>${title}</h1><p>${text}</p>`;
  const all: Response[] = [];
  for (let i = 0; i < 3; i++) all.push(new Response(body, { status: 200 + i }));
  return all;
}
function open(body: string): Response {
  return new Response(body, { status: 200 });
}
const usedAsValues = [open];

const lines: string[] = [];
const hex = (bytes: Uint8Array) => Bun.hash.crc32(bytes).toString(16) + "/" + bytes.length;
const codes = (text: string) => text.length + ":" + Bun.hash.crc32(Buffer.from(text, "utf16le")).toString(16);
async function say(label: string, make: () => Response) {
  const text = await make().text();
  const bytes = new Uint8Array(await make().arrayBuffer());
  const copy = make();
  const cloned = copy.clone();
  const blob = await make().blob();
  lines.push(
    label + ": " + JSON.stringify([codes(text), hex(bytes), codes(await cloned.text()), codes(await copy.text()), blob.size, blob.type, make().headers.get("content-type"), text.slice(0, 24), text.slice(-12)]),
  );
}
const texts: [string, string][] = [
  ["ASCII", filler],
  ["short", "x"],
  ["empty", ""],
  ["Latin-1", filler + "café · naïve ÿ" + filler],
  ["two bytes a character and three", filler + "Ωmega — 東京" + filler],
  ["pairs of surrogates", filler + "😀 and 🤭" + filler],
  ["only wide", "東京".repeat(200)],
  ["a lone high surrogate", filler + "\ud83d" + filler],
  ["a lone low surrogate", filler + "\ude00" + filler],
  ["a high surrogate at the end", filler + "\ud83d"],
  ["a low surrogate at the start", "\ude00" + filler],
  ["a zero", filler + "\0" + filler],
  ["U+FFFD, U+FFFE, U+FFFF", filler + "�￾￿" + filler],
  ["a mark inside", filler + "﻿" + filler],
];
for (const [label, text] of texts) {
  await say("direct, " + label, () => direct("T", text));
  await say("through helpers, " + label, () => throughHelpers(text.slice(0, 40), [text, "b", text.slice(3, 90)]));
  await say("chosen, short, " + label, () => chosen("T", text, true));
  await say("chosen, long, " + label, () => chosen(text.slice(-30), text, false));
  await say("read afterwards, " + label, () => readAfterwards("T", text)[0]);
  await say("kept in a map, " + label, () => keptInAMap("k" + label, text));
  await say("from the map, " + label, () => fromTheMap("k" + label));
  await say("from the map again, " + label, () => fromTheMap("k" + label));
  await say("nothing added, " + label, () => withNothingAdded("k" + label, ""));
  await say("something added, " + label, () => withNothingAdded("k" + label, "!"));
  await say("in a loop, " + label, () => inALoop("T", text)[2]!);
  await say("open, " + label, () => usedAsValues[0]!(`<p>${text}</p>${filler}`));
}
function anyPage(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
const halves = (first: string, second: string) => anyPage(`${first}${filler}`.slice(0, first.length) + `${second}${filler}`);
await say("a pair split between two pieces", () => page(`${filler}\ud83d` + `\ude00${filler}`));
await say("a pair split between a slice and a piece", () => halves(filler + "\ud83d", "\ude00"));
await say("a mark at the start", () => page(`﻿${filler}` + `${filler}.`));
await say("a mark at the start, written as a piece of its own", () => direct("﻿", filler));
await say("the start is a mark after an empty piece", () => page(`${""}﻿` + `${filler}${filler}.`));
await say("slices of a wide text", () => anyPage(`${("東京" + filler).slice(1, 200)}|${("é" + filler).slice(0, 150)}|${filler.slice(5)}`));
await say("numbers and the rest", () => page(`${1.5}${filler}${-0}${null}|${undefined}${true}${12345678901234567890n}${filler}`));
let deep = "";
for (let i = 0; i < 3000; i++) deep = i % 2 ? `<${deep}>` : `${deep}é${i}`;
await say("three thousand levels", () => page(`${deep}!`));
lines.push("the length after: " + readAfterwards("T", filler)[1] + ", the kept text: " + codes(kept.get("kASCII")!));
{
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/wide": () => throughHelpers("東京 😀", [filler, "é", filler]),
      "/narrow": () => throughHelpers("T", [filler, "b", filler]),
      "/later": async () => {
        await Bun.sleep(1);
        return throughHelpers("later — 東京", [filler, filler]);
      },
    },
  });
  for (const path of ["/wide", "/narrow", "/later"]) {
    const answer = await fetch(new URL(path, server.url));
    const bytes = new Uint8Array(await answer.arrayBuffer());
    lines.push("served " + path + ": " + JSON.stringify([answer.status, answer.headers.get("content-type"), answer.headers.get("content-length"), hex(bytes)]));
  }
}
let sum = 0;
for (let i = 0; i < 3000; i++) {
  sum += (await throughHelpers("n" + i, [filler, i % 7 ? "plain" : "東京", filler]).arrayBuffer()).byteLength;
  if (i % 500 === 0) Bun.gc(true);
}
lines.push("many: " + sum);
console.log(lines.join("\n"));
