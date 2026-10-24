// `await body.json()` that goes to a declared type, on bodies that start with a byte order mark. What json() does with a mark depends on what holds the body: a Blob splits off a UTF-8 or a UTF-16 mark and rejects a body that has nothing else, bytes lose a UTF-8 mark only, and a string keeps its first character. The declared type changes none of that.
interface Order {
  id: number;
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

type Body = string | Uint8Array<ArrayBuffer>;
const bodies: [string, Body][] = [
  ["a UTF-8 mark alone", new Uint8Array([0xef, 0xbb, 0xbf])],
  ["a UTF-8 mark and an object", new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])],
  ["a UTF-16 mark and half a unit", new Uint8Array([0xff, 0xfe, 0x7b])],
  ["a UTF-16 mark and an object", new Uint8Array([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00])],
  ["a string of a mark alone", "﻿"],
  ["a string of a mark and an object", "﻿{}"],
];

const readers: [string, (body: Body) => Promise<unknown>][] = [
  ["request", body => ofRequest(new Request("http://localhost/", { method: "POST", body }))],
  ["response", body => ofResponse(new Response(body))],
  ["response over a blob", body => ofResponse(new Response(new Blob([body])))],
  ["blob", body => ofBlob(new Blob([body]))],
];
for (const [reader, read] of readers) {
  for (const [name, body] of bodies) {
    try {
      console.log(reader + ", " + name + ":", JSON.stringify(await read(body)));
    } catch (error) {
      console.log(reader + ", " + name + ": threw", (error as Error).name + ":", (error as Error).message);
    }
  }
}
