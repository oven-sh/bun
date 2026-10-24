// `await body.json()` that goes to a declared type, on a body without bytes. The error is the one json() rejects with, which is not the error of JSON.parse(""). Bodies that are blank, or hold a byte order mark or a part of one, stand beside it.
// TODO: the build counts 0: STATISTIC: ParsersCreated >= 1
interface Order {
  id: number;
  items: string[];
}

async function ofRequest(request: Request): Promise<unknown> {
  return (await request.json()) as Order;
}
async function ofResponse(response: Response): Promise<unknown> {
  return (await response.json()) as Order;
}
async function ofBlob(blob: Blob): Promise<unknown> {
  return (await blob.json()) as Order;
}
async function untyped(response: Response): Promise<unknown> {
  return await response.json();
}

type Body = string | Uint8Array<ArrayBuffer>;
const bodies: [string, Body][] = [
  ["no text", ""],
  ["no bytes", new Uint8Array([])],
  ["a UTF-8 mark and a blank", new Uint8Array([0xef, 0xbb, 0xbf, 0x20])],
  ["a UTF-8 mark and an object", new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])],
  ["two bytes of a UTF-8 mark", new Uint8Array([0xef, 0xbb])],
  ["a blank", " "],
  ["a line break", "\n"],
  ["a UTF-16 mark alone", new Uint8Array([0xff, 0xfe])],
  ["an object", '{"id":1,"items":["a"]}'],
  ["null", "null"],
];

const readers: [string, (body: Body) => Promise<unknown>][] = [
  ["request", body => ofRequest(new Request("http://localhost/", { method: "POST", body }))],
  ["response", body => ofResponse(new Response(body))],
  ["blob", body => ofBlob(new Blob([body]))],
  ["untyped", body => untyped(new Response(body))],
];
for (const [reader, read] of readers) {
  for (const [name, body] of bodies) {
    try {
      console.log(reader + ", " + name + ":", JSON.stringify(await read(body)));
    } catch (error) {
      console.log(reader + ", " + name + ": threw", (error as Error).name + ":", (error as Error).message, error instanceof SyntaxError);
    }
  }
}

try {
  await ofRequest(new Request("http://localhost/"));
} catch (error) {
  console.log("a request without a body: threw", (error as Error).name + ":", (error as Error).message);
}
