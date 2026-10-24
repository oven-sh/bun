// Whatever object type `await request.json()` goes to, a body that holds an object, an array or null gives what json() gives, whatever its members are, and a body that is no JSON gives the error of json(). So does a body that starts with a byte order mark (rows 20, 22 and 23). A body that holds a number or a string gives that number or string.
interface Order {
  customer: { id: number; name: string };
  items: { sku: string; quantity: number }[];
  coupon?: string;
}

function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value + " " + String(value);
  return JSON.stringify(value) + " " + Reflect.ownKeys(value).map(String).join() + " " + (Object.getPrototypeOf(value) === (Array.isArray(value) ? Array.prototype : Object.prototype));
}

function failure(error: unknown): string {
  return error instanceof TypeError ? "TypeError" : (error as Error).name + ": " + (error as Error).message;
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
async function annotated(request: Request): Promise<unknown> {
  const order: Order = await request.json();
  return order;
}
async function untyped(request: Request): Promise<unknown> {
  return await request.json();
}
async function notAwaited(request: Request): Promise<unknown> {
  const pending = request.json() as Promise<Order>;
  return await pending;
}

const encoder = new TextEncoder();
type Body = string | Uint8Array<ArrayBuffer>;
const bodies: Body[] = [
  '{"customer":{"id":1,"name":"n"},"items":[{"sku":"a","quantity":2}],"coupon":"c"}',
  '{"customer":{"id":1,"name":"n"},"items":[]}',
  '{"customer":{"id":1,"name":"Zoë 中文 😀"},"items":[{"sku":"\\u0041\\n","quantity":-0}]}',
  '{ "customer": { "id": 1, "name": "n" }, "items": [ { "sku": "a", "quantity": 2 } ] }',
  '{"items":[],"customer":{"name":"n","id":1}}',
  '{"customer":{"id":1,"name":"n","more":true},"items":[],"__proto__":{"x":1},"0":0}',
  '{"customer":{"id":"1","name":2},"items":{"length":0}}',
  '{"customer":null,"items":null}',
  '{"customer":{"id":1,"name":"n"},"customer":5,"items":[]}',
  "{}",
  "[]",
  "null",
  "5",
  '"text"',
  "",
  " ",
  "{",
  '{"customer":{"id":1,"name":"n"},"items":[]',
  '{"customer":{"id":1,"name":"n"},"items":[]}x',
  '{"customer":{"id":01,"name":"n"},"items":[]}',
  "﻿{}",
  new Uint8Array([]),
  new Uint8Array([0xef, 0xbb, 0xbf]),
  new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('{"customer":{"id":1,"name":"n"},"items":[]}')]),
  new Uint8Array([...encoder.encode('{"customer":{"id":1,"name":"'), 0xff, 0xc3, 0x28, ...encoder.encode('"},"items":[]}')]),
  new Uint8Array([0x31, 0x00]),
];

const readers: [string, (body: Body) => Promise<unknown>][] = [
  ["request", body => ofRequest(new Request("http://localhost/", { method: "POST", body }))],
  ["response", body => ofResponse(new Response(body))],
  ["blob", body => ofBlob(new Blob([body]))],
  ["annotated", body => annotated(new Request("http://localhost/", { method: "POST", body }))],
  ["untyped", body => untyped(new Request("http://localhost/", { method: "POST", body }))],
  ["not awaited", body => notAwaited(new Request("http://localhost/", { method: "POST", body }))],
];
for (const [name, read] of readers) {
  for (let at = 0; at < bodies.length; at++) {
    try {
      console.log(name, at, describe(await read(bodies[at]!)));
    } catch (error) {
      console.log(name, at, "threw", failure(error));
    }
  }
}

class Overriding extends Request {
  override json(): Promise<any> {
    return Promise.resolve({ overridden: true });
  }
}
class Inheriting extends Request {}
const withOwnProperty = new Request("http://localhost/", { method: "POST", body: "{}" });
(withOwnProperty as any).json = () => Promise.resolve("own property");
const lookalike = { json: () => Promise.resolve("no request at all"), bytes: () => Promise.reject(new Error("bytes() was called")) };
const used = new Request("http://localhost/", { method: "POST", body: "{}" });
await used.text();
const others: [string, unknown][] = [
  ["a subclass that overrides json", new Overriding("http://localhost/", { method: "POST", body: "{}" })],
  ["a subclass that inherits json", new Inheriting("http://localhost/", { method: "POST", body: '{"customer":{"id":1,"name":"n"},"items":[]}' })],
  ["an own property", withOwnProperty],
  ["another object", lookalike],
  ["a body already used", used],
  ["without a body", new Request("http://localhost/")],
];
for (const [name, value] of others) {
  try {
    console.log(name + ":", describe(await ofRequest(value as Request)));
  } catch (error) {
    console.log(name + ": threw", failure(error));
  }
}

const twice = new Request("http://localhost/", { method: "POST", body: "{}" });
console.log(twice.bodyUsed, describe(await ofRequest(twice)), twice.bodyUsed);
try {
  await ofRequest(twice);
} catch (error) {
  console.log("threw", failure(error));
}

const order: string[] = [];
const first = ofRequest(new Request("http://localhost/", { method: "POST", body: '{"customer":{"id":1,"name":"n"},"items":[]}' })).then(() => order.push("typed"));
const second = untyped(new Request("http://localhost/", { method: "POST", body: '{"customer":{"id":1,"name":"n"},"items":[]}' })).then(() => order.push("untyped"));
Promise.resolve().then(() => order.push("one tick"));
await Promise.all([first, second]);
console.log(order.join());
