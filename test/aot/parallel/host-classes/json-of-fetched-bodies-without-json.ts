import { tmpdir } from "node:os";
import { join } from "node:path";
interface Order {
  id: number;
  name: string;
}
const contents: [string, number[]][] = [
  ["nothing", []],
  ["the mark of UTF-8", [239, 187, 191]],
  ["the mark of UTF-16", [255, 254]],
  ["the mark of UTF-16, high byte first", [254, 255]],
  ["a space", [32]],
  ["a line end", [10]],
  ["all white space", [9, 10, 13, 32]],
  ["null", [110, 117, 108, 108]],
  ["null between spaces", [32, 110, 117, 108, 108, 32]],
  ["null behind the mark of UTF-8", [239, 187, 191, 110, 117, 108, 108]],
  ["null behind the mark of UTF-16", [255, 254, 110, 0, 117, 0, 108, 0, 108, 0]],
  ["an order", [123, 34, 105, 100, 34, 58, 49, 44, 34, 110, 97, 109, 101, 34, 58, 34, 97, 34, 125]],
];
async function attempt(read: () => Promise<unknown>): Promise<string> {
  try {
    const value = await read();
    return value === undefined ? "undefined" : JSON.stringify(value);
  } catch (error) {
    return "throws " + (error as Error).name + ": " + (error as Error).message;
  }
}
const textOf = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
function streamOf(bytes: Uint8Array<ArrayBuffer>, type?: "bytes") {
  return new ReadableStream({
    type,
    start(controller: any) {
      if (bytes.length) controller.enqueue(bytes);
      controller.close();
    },
  } as any);
}
function lateStreamOf(bytes: Uint8Array<ArrayBuffer>) {
  return new ReadableStream({
    async pull(controller) {
      await new Promise(resolve => setImmediate(resolve));
      if (bytes.length) controller.enqueue(bytes);
      controller.close();
    },
  });
}
function directStreamOf(bytes: Uint8Array<ArrayBuffer>) {
  return new ReadableStream({
    type: "direct",
    pull(controller: { write(chunk: Uint8Array): void; end(): void }) {
      if (bytes.length) controller.write(bytes);
      controller.end();
    },
  } as any);
}
async function* piecesOf(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length) yield bytes;
}

// One exchange is under way at a time. Whoever sends a body sends its head and leaves the rest here, and the reader asks for the rest in the turn in which it calls json().
let theRest: (() => void) | undefined;
function sendTheRest() {
  setImmediate(() => {
    const send = theRest;
    theRest = undefined;
    send?.();
  });
}
function framed(bytes: Uint8Array, how: string): (string | Uint8Array)[] {
  if (how !== "chunked") return [bytes];
  return bytes.length ? [bytes.length.toString(16) + "\r\n", bytes, "\r\n0\r\n\r\n"] : ["0\r\n\r\n"];
}
const lengthOf = (bytes: Uint8Array, how: string) =>
  how === "chunked"
    ? "Transfer-Encoding: chunked\r\n"
    : how === "open"
      ? ""
      : "Content-Length: " + bytes.length + "\r\n";

const sender = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, request) {
      const [how, when, list] = request.toString("latin1").split(" ")[1].split("?")[0].split("/").slice(-3);
      const bytes = Uint8Array.from(list.split("-").filter(Boolean).map(Number));
      socket.write("HTTP/1.1 200 OK\r\n" + lengthOf(bytes, how) + "Connection: close\r\n\r\n");
      const rest = () => {
        for (const piece of framed(bytes, how)) socket.write(piece);
        socket.end();
      };
      if (when === "now") rest();
      else theRest = rest;
    },
  },
});
const from = (how: string, list: number[]) =>
  "http://127.0.0.1:" + sender.port + "/" + how + "/later/-" + list.join("-");
const bucket = new Bun.S3Client({
  endpoint: "http://127.0.0.1:" + sender.port,
  accessKeyId: "a",
  secretAccessKey: "b",
  bucket: "c",
});

async function cell0(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell1(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell2(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell3(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell4(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell5(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell6(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell7(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell8(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell9(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell10(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell11(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("counted", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell12(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell13(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell14(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell15(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell16(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell17(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell18(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell19(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell20(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell21(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell22(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell23(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell24(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell25(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell26(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell27(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell28(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell29(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell30(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell31(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell32(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell33(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell34(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell35(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("open", list));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell36(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell37(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell38(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell39(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell40(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell41(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell42(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell43(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell44(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell45(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell46(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell47(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = (await fetch(from("chunked", list))).clone();
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell48(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell49(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell50(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell51(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell52(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell53(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell54(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell55(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell56(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell57(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell58(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell59(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Response((await fetch(from("chunked", list))).body);
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell60(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell61(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell62(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell63(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell64(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell65(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell66(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell67(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell68(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell69(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell70(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell71(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = new Request("http://localhost/", { method: "POST", body: (await fetch(from("chunked", list))).body });
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell72(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list)).then(response => (sendTheRest(), response.blob()));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell73(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list)).then(response => (sendTheRest(), response.blob()));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell74(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list)).then(response => (sendTheRest(), response.blob()));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell75(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list)).then(response => (sendTheRest(), response.blob()));
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell76(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list)).then(response => (sendTheRest(), response.blob()));
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell77(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(from("chunked", list)).then(response => (sendTheRest(), response.blob()));
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell78(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell79(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell80(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell81(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell82(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell83(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell84(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell85(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell86(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell87(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell88(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell89(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch("data:application/json;base64," + btoa(textOf(bytes)));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell90(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell91(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell92(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell93(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell94(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell95(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell96(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell97(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell98(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell99(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell100(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell101(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(URL.createObjectURL(new Blob([bytes])));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell102(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell103(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell104(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell105(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell106(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell107(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell108(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell109(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell110(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell111(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell112(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell113(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = await fetch(Bun.pathToFileURL(file));
  holder.body;
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell114(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = bucket.file("counted/now/-" + list.join("-"));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order;
}
async function cell115(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = bucket.file("counted/now/-" + list.join("-"));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as Order | null;
}
async function cell116(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = bucket.file("counted/now/-" + list.join("-"));
  sendTheRest();
  // @ts-ignore
  return (await holder.json()) as unknown;
}
async function cell117(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = bucket.file("counted/now/-" + list.join("-"));
  sendTheRest();
  // @ts-ignore
  return await holder.json();
}
async function cell118(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = bucket.file("counted/now/-" + list.join("-"));
  sendTheRest();
  // @ts-ignore
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell119(list: number[], file: string) {
  const bytes = Uint8Array.from(list);
  const holder = bucket.file("counted/now/-" + list.join("-"));
  sendTheRest();
  // @ts-ignore
  return (await holder.text().then(() => holder.json())) as Order;
}
for (const [name, list] of contents) {
  const file = join(tmpdir(), `holds-${name.replaceAll(" ", "-").replaceAll(",", "")}-${process.pid}`);
  await Bun.write(file, Uint8Array.from(list));
  console.log(
    [
      name,
      "fetched, with a length",
      "",
      "order " + (await attempt(() => cell0(list, file))),
      "order or null " + (await attempt(() => cell1(list, file))),
      "unknown " + (await attempt(() => cell2(list, file))),
      "any " + (await attempt(() => cell3(list, file))),
      "twice " + (await attempt(() => cell4(list, file))),
      "behind text() " + (await attempt(() => cell5(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched, with a length",
      "body was read",
      "order " + (await attempt(() => cell6(list, file))),
      "order or null " + (await attempt(() => cell7(list, file))),
      "unknown " + (await attempt(() => cell8(list, file))),
      "any " + (await attempt(() => cell9(list, file))),
      "twice " + (await attempt(() => cell10(list, file))),
      "behind text() " + (await attempt(() => cell11(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched, chunked",
      "",
      "order " + (await attempt(() => cell12(list, file))),
      "order or null " + (await attempt(() => cell13(list, file))),
      "unknown " + (await attempt(() => cell14(list, file))),
      "any " + (await attempt(() => cell15(list, file))),
      "twice " + (await attempt(() => cell16(list, file))),
      "behind text() " + (await attempt(() => cell17(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched, chunked",
      "body was read",
      "order " + (await attempt(() => cell18(list, file))),
      "order or null " + (await attempt(() => cell19(list, file))),
      "unknown " + (await attempt(() => cell20(list, file))),
      "any " + (await attempt(() => cell21(list, file))),
      "twice " + (await attempt(() => cell22(list, file))),
      "behind text() " + (await attempt(() => cell23(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched, until the end",
      "",
      "order " + (await attempt(() => cell24(list, file))),
      "order or null " + (await attempt(() => cell25(list, file))),
      "unknown " + (await attempt(() => cell26(list, file))),
      "any " + (await attempt(() => cell27(list, file))),
      "twice " + (await attempt(() => cell28(list, file))),
      "behind text() " + (await attempt(() => cell29(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched, until the end",
      "body was read",
      "order " + (await attempt(() => cell30(list, file))),
      "order or null " + (await attempt(() => cell31(list, file))),
      "unknown " + (await attempt(() => cell32(list, file))),
      "any " + (await attempt(() => cell33(list, file))),
      "twice " + (await attempt(() => cell34(list, file))),
      "behind text() " + (await attempt(() => cell35(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "a clone of what was fetched",
      "",
      "order " + (await attempt(() => cell36(list, file))),
      "order or null " + (await attempt(() => cell37(list, file))),
      "unknown " + (await attempt(() => cell38(list, file))),
      "any " + (await attempt(() => cell39(list, file))),
      "twice " + (await attempt(() => cell40(list, file))),
      "behind text() " + (await attempt(() => cell41(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "a clone of what was fetched",
      "body was read",
      "order " + (await attempt(() => cell42(list, file))),
      "order or null " + (await attempt(() => cell43(list, file))),
      "unknown " + (await attempt(() => cell44(list, file))),
      "any " + (await attempt(() => cell45(list, file))),
      "twice " + (await attempt(() => cell46(list, file))),
      "behind text() " + (await attempt(() => cell47(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "a response of the body of what was fetched",
      "",
      "order " + (await attempt(() => cell48(list, file))),
      "order or null " + (await attempt(() => cell49(list, file))),
      "unknown " + (await attempt(() => cell50(list, file))),
      "any " + (await attempt(() => cell51(list, file))),
      "twice " + (await attempt(() => cell52(list, file))),
      "behind text() " + (await attempt(() => cell53(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "a response of the body of what was fetched",
      "body was read",
      "order " + (await attempt(() => cell54(list, file))),
      "order or null " + (await attempt(() => cell55(list, file))),
      "unknown " + (await attempt(() => cell56(list, file))),
      "any " + (await attempt(() => cell57(list, file))),
      "twice " + (await attempt(() => cell58(list, file))),
      "behind text() " + (await attempt(() => cell59(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "a request of the body of what was fetched",
      "",
      "order " + (await attempt(() => cell60(list, file))),
      "order or null " + (await attempt(() => cell61(list, file))),
      "unknown " + (await attempt(() => cell62(list, file))),
      "any " + (await attempt(() => cell63(list, file))),
      "twice " + (await attempt(() => cell64(list, file))),
      "behind text() " + (await attempt(() => cell65(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "a request of the body of what was fetched",
      "body was read",
      "order " + (await attempt(() => cell66(list, file))),
      "order or null " + (await attempt(() => cell67(list, file))),
      "unknown " + (await attempt(() => cell68(list, file))),
      "any " + (await attempt(() => cell69(list, file))),
      "twice " + (await attempt(() => cell70(list, file))),
      "behind text() " + (await attempt(() => cell71(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "a blob of what was fetched",
      "",
      "order " + (await attempt(() => cell72(list, file))),
      "order or null " + (await attempt(() => cell73(list, file))),
      "unknown " + (await attempt(() => cell74(list, file))),
      "any " + (await attempt(() => cell75(list, file))),
      "twice " + (await attempt(() => cell76(list, file))),
      "behind text() " + (await attempt(() => cell77(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched from a data: URL",
      "",
      "order " + (await attempt(() => cell78(list, file))),
      "order or null " + (await attempt(() => cell79(list, file))),
      "unknown " + (await attempt(() => cell80(list, file))),
      "any " + (await attempt(() => cell81(list, file))),
      "twice " + (await attempt(() => cell82(list, file))),
      "behind text() " + (await attempt(() => cell83(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched from a data: URL",
      "body was read",
      "order " + (await attempt(() => cell84(list, file))),
      "order or null " + (await attempt(() => cell85(list, file))),
      "unknown " + (await attempt(() => cell86(list, file))),
      "any " + (await attempt(() => cell87(list, file))),
      "twice " + (await attempt(() => cell88(list, file))),
      "behind text() " + (await attempt(() => cell89(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched from a blob: URL",
      "",
      "order " + (await attempt(() => cell90(list, file))),
      "order or null " + (await attempt(() => cell91(list, file))),
      "unknown " + (await attempt(() => cell92(list, file))),
      "any " + (await attempt(() => cell93(list, file))),
      "twice " + (await attempt(() => cell94(list, file))),
      "behind text() " + (await attempt(() => cell95(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched from a blob: URL",
      "body was read",
      "order " + (await attempt(() => cell96(list, file))),
      "order or null " + (await attempt(() => cell97(list, file))),
      "unknown " + (await attempt(() => cell98(list, file))),
      "any " + (await attempt(() => cell99(list, file))),
      "twice " + (await attempt(() => cell100(list, file))),
      "behind text() " + (await attempt(() => cell101(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched from a file: URL",
      "",
      "order " + (await attempt(() => cell102(list, file))),
      "order or null " + (await attempt(() => cell103(list, file))),
      "unknown " + (await attempt(() => cell104(list, file))),
      "any " + (await attempt(() => cell105(list, file))),
      "twice " + (await attempt(() => cell106(list, file))),
      "behind text() " + (await attempt(() => cell107(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "fetched from a file: URL",
      "body was read",
      "order " + (await attempt(() => cell108(list, file))),
      "order or null " + (await attempt(() => cell109(list, file))),
      "unknown " + (await attempt(() => cell110(list, file))),
      "any " + (await attempt(() => cell111(list, file))),
      "twice " + (await attempt(() => cell112(list, file))),
      "behind text() " + (await attempt(() => cell113(list, file))),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "a file in a bucket",
      "",
      "order " + (await attempt(() => cell114(list, file))),
      "order or null " + (await attempt(() => cell115(list, file))),
      "unknown " + (await attempt(() => cell116(list, file))),
      "any " + (await attempt(() => cell117(list, file))),
      "twice " + (await attempt(() => cell118(list, file))),
      "behind text() " + (await attempt(() => cell119(list, file))),
    ].join(" | "),
  );
  await Bun.file(file).delete();
}
sender.stop(true);
