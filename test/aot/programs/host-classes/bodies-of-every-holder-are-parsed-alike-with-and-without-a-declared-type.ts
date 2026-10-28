// `await body.json()` gives the same whether or not it goes to a declared type, whatever holds the body: a string, bytes, a Blob, a stream of bytes or of strings, a file, a request or a response that came over the network.
// The bodies are drawn from a fixed seed: JSON that fits the type and JSON that does not, behind byte order marks of every kind, with lone surrogates, with bytes that are no UTF-8, cut short, blank and empty.
// STATISTIC: TypedResultsSelected >= 9
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Order {
  id: number;
  name: string;
  tags?: string[];
  more?: { deep: boolean | null };
}

async function requestCast(body: Request): Promise<unknown> {
  return (await body.json()) as Order;
}
async function requestAnnotated(body: Request): Promise<unknown> {
  const order: Order = await body.json();
  return order;
}
async function requestReturned(body: Request): Promise<Order> {
  return await body.json();
}
async function responseCast(body: Response): Promise<unknown> {
  return (await body.json()) as Order;
}
async function responseAnnotated(body: Response): Promise<unknown> {
  const order: Order = await body.json();
  return order;
}
async function responseReturned(body: Response): Promise<Order> {
  return await body.json();
}
async function blobCast(body: Blob): Promise<unknown> {
  return (await body.json()) as Order;
}
async function blobAnnotated(body: Blob): Promise<unknown> {
  const order: Order = await body.json();
  return order;
}
async function blobReturned(body: Blob): Promise<Order> {
  return await body.json();
}
async function untyped(body: any): Promise<unknown> {
  return await body.json();
}

let state = 0x2545f491;
function below(limit: number): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) % limit;
}
const pick = <T>(list: readonly T[]): T => list[below(list.length)]!;

const inTexts = [
  "n",
  "",
  "é",
  "中文",
  "😀",
  "\ud800",
  "\udc00",
  "\udc00\ud800",
  "\ufeff",
  "\\ud800",
  "\\u0041\\n",
  "\u0000",
  "ï»¿",
  "a".repeat(40),
];
const inBytes = [
  [0x6e],
  [0xff],
  [0xc3, 0x28],
  [0xed, 0xa0, 0x80],
  [0xf0, 0x9f, 0x98, 0x80],
  [0xc0, 0x80],
  [0xe4, 0xb8],
  [0xef, 0xbb, 0xbf],
  [0xc3, 0xa9],
  [0xf4, 0x90, 0x80, 0x80],
];
const shapes = [
  '{"id":1,"name":"@"}',
  '{"id":1,"name":"@","tags":["@","x"],"more":{"deep":null}}',
  '{"name":"@","id":-0.5}',
  '{ "id" : 1 , "name" : "@" , "other" : [ "@" ] }',
  '{"id":"1","name":2,"@":"@"}',
  '{"id":1,"name":"@","id":2}',
  '["@"]',
  '"@"',
  "{}",
  "null",
  "5",
  "",
  " ",
  "\n",
  '{"id":1,"name":"@"',
  '{"id":1,"name":"@"}x',
  "@",
];
const marksOfTexts = ["", "", "", "\ufeff", "\ufeff\ufeff", "\ufffe", " \ufeff", "ï»¿", "ÿþ"];
const marksOfBytes = [
  [],
  [],
  [],
  [0xef, 0xbb, 0xbf],
  [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf],
  [0xff, 0xfe],
  [0xfe, 0xff],
  [0xef, 0xbb],
  [0xff],
  [0xff, 0xfe, 0xff, 0xfe],
  [0x00],
  [0xff, 0xfe, 0x00, 0x00],
];

const encoder = new TextEncoder();
function drawText(): string {
  return pick(marksOfTexts) + pick(shapes).replaceAll("@", () => pick(inTexts));
}
function drawBytes(): Uint8Array<ArrayBuffer> {
  const mark = pick(marksOfBytes);
  if (below(4) === 0) {
    const text = drawText();
    const wide: number[] = [];
    for (let at = 0; at < text.length; at++) wide.push(text.charCodeAt(at) & 0xff, text.charCodeAt(at) >> 8);
    return new Uint8Array([...mark, ...wide, ...(below(4) === 0 ? [0x7d] : [])]);
  }
  const parts = pick(shapes).split("@");
  return new Uint8Array([
    ...mark,
    ...parts.flatMap((part, at) => [...(at > 0 ? pick(inBytes) : []), ...encoder.encode(part)]),
  ]);
}
function streamOf(chunks: (string | Uint8Array<ArrayBuffer>)[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
function cut<T extends string | Uint8Array<ArrayBuffer>>(whole: T, at: number): T[] {
  return [whole.slice(0, at), whole.slice(at)] as T[];
}

const folder = mkdtempSync(join(tmpdir(), "bodies-"));
const file = join(folder, "body.json");
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const way = new URL(request.url).pathname;
    if (way === "/echo") return new Response(await request.bytes());
    return Response.json(
      await tell(() =>
        way === "/cast"
          ? requestCast(request)
          : way === "/annotated"
            ? requestAnnotated(request)
            : way === "/returned"
              ? requestReturned(request)
              : untyped(request),
      ),
    );
  },
});

async function tell(read: () => Promise<unknown>): Promise<string> {
  try {
    const value = await read();
    return (
      JSON.stringify(value) +
      " " +
      (typeof value === "object" && value !== null ? Reflect.ownKeys(value).map(String).join() : typeof value)
    );
  } catch (error) {
    return "threw " + (error as Error).name + ": " + (error as Error).message;
  }
}

type Body = string | Uint8Array<ArrayBuffer>;
type Read = (body: Body, at: number) => Promise<unknown>;
const post = (body: BodyInit) => ({ method: "POST", body });
const requests: [string, (body: Body, at: number) => Request][] = [
  ["a request", body => new Request("http://localhost/", post(body))],
  ["a request over a blob", body => new Request("http://localhost/", post(new Blob([body])))],
  ["a request over a stream", body => new Request("http://localhost/", post(streamOf([body])))],
  ["a copy of a request", body => new Request("http://localhost/", post(body)).clone()],
];
const responses: [string, (body: Body, at: number) => Response | Promise<Response>][] = [
  ["a response", body => new Response(body)],
  ["a response over a blob", body => new Response(new Blob([body]))],
  ["a response over a stream", (body, at) => new Response(streamOf(cut(body, at)))],
  ["a response whose stream was taken", body => new Response(new Response(body).body)],
  ["a copy of a response", body => new Response(body).clone()],
  ["a response over a file", body => (writeFileSync(file, body), new Response(Bun.file(file)))],
  ["a response of fetch", body => fetch(server.url + "echo", post(body))],
];
const blobs: [string, (body: Body, at: number) => Blob][] = [
  ["a blob", body => new Blob([body])],
  ["a blob of two parts", (body, at) => new Blob(cut(body, at))],
  ["a part of a blob", body => new Blob(["{", body, "}"]).slice(1, -1)],
  ["a file", body => (writeFileSync(file, body), Bun.file(file))],
];

let differences = 0;
async function sweep(name: string, readers: [Read, Read, Read, Read]) {
  let digest = 0;
  let thrown = 0;
  for (let round = 0; round < 240; round++) {
    const body = round % 2 === 0 ? drawText() : drawBytes();
    const at = below(body.length + 1);
    const answers: string[] = [];
    for (const read of readers) answers.push(await tell(() => read(body, at)));
    if (answers.some(answer => answer !== answers[3]) && differences++ < 20)
      console.log(
        name,
        "DIFFERS for",
        typeof body === "string" ? JSON.stringify(body) : Array.from(body, byte => byte.toString(16)).join(" "),
        answers,
      );
    if (answers[3]!.startsWith("threw")) thrown++;
    for (const answer of answers)
      for (let at = 0; at < answer.length; at++) digest = (Math.imul(digest, 31) + answer.charCodeAt(at)) | 0;
  }
  console.log(name + ":", thrown, "of 240 throw,", (digest >>> 0).toString(16));
}
for (const [name, make] of requests)
  await sweep(name, [
    (body, at) => requestCast(make(body, at)),
    (body, at) => requestAnnotated(make(body, at)),
    (body, at) => requestReturned(make(body, at)),
    (body, at) => untyped(make(body, at)),
  ]);
for (const [name, make] of responses)
  await sweep(name, [
    async (body, at) => responseCast(await make(body, at)),
    async (body, at) => responseAnnotated(await make(body, at)),
    async (body, at) => responseReturned(await make(body, at)),
    async (body, at) => untyped(await make(body, at)),
  ]);
for (const [name, make] of blobs)
  await sweep(name, [
    (body, at) => blobCast(make(body, at)),
    (body, at) => blobAnnotated(make(body, at)),
    (body, at) => blobReturned(make(body, at)),
    (body, at) => untyped(make(body, at)),
  ]);
const asked =
  (way: string): Read =>
  async body =>
    JSON.parse(await (await fetch(server.url + way, post(body))).text());
await sweep("a request of a server", [asked("cast"), asked("annotated"), asked("returned"), asked("untyped")]);
console.log(differences, "differences");
server.stop(true);
rmSync(folder, { recursive: true });
