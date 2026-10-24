// The text comes from buffers, decoders, files, responses, streams and other makers of strings, whole and in slices: JSON.parse<T> gives what JSON.parse gives.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Row = { id: number; name: string; tags: string[] };
const ascii = '[{"id":1,"name":"one","tags":["a","b"]},{"name":"two","u":{"v":[1,2]},"id":2,"tags":[]}]';
const latin = ascii.replace("one", "éÿ");
const wide = ascii.replace("one", "日本😀");
const folder = mkdtempSync(join(tmpdir(), "json-sources-"));
let different = 0;
let texts = 0;

function check(text: string): void {
  for (const given of [text, " " + text, text + "\n", (text + text).slice(0, text.length), ("[" + text + "]").slice(1, -1), text.slice(0, -1), text.slice(1)]) {
    texts++;
    let typed = "";
    let plain = "";
    try {
      typed = JSON.stringify(JSON.parse<Row[]>(given));
    } catch (error: any) {
      typed = error.name + ": " + error.message;
    }
    try {
      plain = JSON.stringify((JSON.parse as (text: string) => unknown)(given));
    } catch (error: any) {
      plain = error.name + ": " + error.message;
    }
    if (typed !== plain) different++;
  }
}

for (const [label, text] of [["ASCII", ascii], ["Latin-1", latin], ["16-bit", wide]]) {
  const bytes = Buffer.from(text, "utf8");
  const path = join(folder, label + ".json");
  writeFileSync(path, bytes);
  const sources: string[] = [
    text,
    bytes.toString(),
    bytes.toString("utf8", 0, bytes.length),
    Buffer.from(text, "utf16le").toString("utf16le"),
    Buffer.from(text, "latin1").toString("latin1"),
    Buffer.from(bytes.toString("base64"), "base64").toString(),
    new TextDecoder().decode(bytes),
    new TextDecoder("utf-16le").decode(Buffer.from(text, "utf16le")),
    readFileSync(path, "utf8"),
    await Bun.file(path).text(),
    await new Response(bytes).text(),
    await new Response(text).text(),
    await new Blob([bytes]).text(),
    await Bun.readableStreamToText(new Blob([bytes]).stream()),
    JSON.stringify(JSON.parse(text)),
    JSON.parse(JSON.stringify(text)),
    text.normalize(),
    text.toWellFormed(),
    text.split("").join(""),
    [...text].join(""),
    text.replace("id", "id"),
    text.padEnd(text.length + 3).trimEnd(),
    String(new String(text)),
    `${text}`,
    Object.keys({ [text]: 1 })[0],
    Symbol(text).description!,
    new URLSearchParams({ t: text }).get("t")!,
    decodeURIComponent(encodeURIComponent(text)),
    structuredClone(text),
    new Error(text).message,
    Bun.inspect(text).length > 0 ? text.concat("") : "",
  ];
  for (const source of sources) check(source);
  console.log(label + ": " + sources.length + " sources, " + texts + " texts: " + different + " differ");
}
rmSync(folder, { recursive: true, force: true });
