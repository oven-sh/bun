// request.json(), response.json() and blob.json() on bodies of bytes: whatever the bytes are, twice each, so that the second goes by what the first has taught.
function describe(value: unknown): string {
  if (value === null || typeof value !== "object") return typeof value + ":" + String(value);
  if (Array.isArray(value)) return "[" + value.map(describe).join() + "]";
  return "{" + Reflect.ownKeys(value).map(key => JSON.stringify(String(key)) + "=" + describe((value as Record<string, unknown>)[key as string])).join() + "}";
}
function codes(text: string): string {
  return [...text].map(character => character.codePointAt(0)!.toString(16)).join(" ");
}
const encoder = new TextEncoder();
const bytesOf = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap(part => (typeof part === "string" ? [...encoder.encode(part)] : part)));
const bodies: [string, Uint8Array<ArrayBuffer>][] = [
  ["plain", bytesOf('{"customer":{"id":1,"name":"n"},"items":[{"sku":"a","quantity":2}]}')],
  ["two letters outside ASCII", bytesOf('{"customer":{"id":4711,"name":"Zoë Müller"},"items":[{"sku":"a","quantity":2}]}')],
  ["three and four bytes a character", bytesOf('{"customer":{"id":1,"name":"東京 😀"},"items":[]}')],
  ["a key outside ASCII", bytesOf('{"customer":{"id":1,"näme":"n","東":2},"items":[]}')],
  ["escapes beside bytes", bytesOf('{"customer":{"id":1,"name":"ë\\u00eb\\n\\ud83d\\ude00ë"},"items":[]}')],
  ["a character cut at the end of a string", bytesOf('{"customer":{"id":1,"name":"a', [0xc3], '"},"items":[]}')],
  ["a stray continuation byte", bytesOf('{"customer":{"id":1,"name":"a', [0xab], 'b"},"items":[]}')],
  ["an overlong slash", bytesOf('{"customer":{"id":1,"name":"a', [0xc0, 0xaf], 'b"},"items":[]}')],
  ["a surrogate written as three bytes", bytesOf('{"customer":{"id":1,"name":"a', [0xed, 0xa0, 0x80], 'b"},"items":[]}')],
  ["beyond U+10FFFF", bytesOf('{"customer":{"id":1,"name":"a', [0xf4, 0x90, 0x80, 0x80], 'b"},"items":[]}')],
  ["0xff in a key", bytesOf('{"customer":{"id":1,"na', [0xff], 'me":"n"},"items":[]}')],
  ["a byte outside ASCII between the tokens", bytesOf('{"customer":', [0xc2, 0xa0], '{"id":1,"name":"n"},"items":[]}')],
  ["the text cut inside a character", bytesOf('{"customer":{"id":1,"name":"', [0xe6, 0x9d])],
  ["a mark, then letters outside ASCII", bytesOf([0xef, 0xbb, 0xbf], '{"customer":{"id":1,"name":"Zoë"},"items":[]}')],
  ["two marks", bytesOf([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], '{"customer":{"id":1,"name":"n"},"items":[]}')],
  ["a mark in a string", bytesOf('{"customer":{"id":1,"name":"', [0xef, 0xbb, 0xbf], '"},"items":[]}')],
  ["UTF-16, little end first, with its mark", new Uint8Array([0xff, 0xfe, ...[...'{"a":"ë"}'].flatMap(character => [character.charCodeAt(0) & 0xff, character.charCodeAt(0) >> 8])])],
  ["a zero byte in a string", bytesOf('{"customer":{"id":1,"name":"a', [0], 'b"},"items":[]}')],
  ["a zero byte at the end", bytesOf('{"customer":{"id":1,"name":"n"},"items":[]}', [0])],
  ["indented, with letters outside ASCII", bytesOf(JSON.stringify({ customer: { id: 1, name: "Zoë" }, items: [{ sku: "å", quantity: 1 }] }, null, 2))],
];
const readers: [string, (body: Uint8Array<ArrayBuffer>) => Promise<unknown>][] = [
  ["request", body => new Request("http://localhost/", { method: "POST", body }).json()],
  ["response", body => new Response(body).json()],
  ["blob", body => new Blob([body]).json()],
];
for (const [reader, read] of readers) {
  for (const [label, body] of bodies) {
    for (let turn = 0; turn < 2; turn++) {
      try {
        const value = (await read(body)) as { customer?: { name?: string } };
        console.log(reader, label, turn, describe(value), typeof value?.customer?.name === "string" ? codes(value.customer.name) : "");
      } catch (error) {
        console.log(reader, label, turn, "threw", (error as Error).name + ":", (error as Error).message);
      }
    }
  }
}
