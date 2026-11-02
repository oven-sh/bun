export {};
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

let read: (request: Request) => Promise<unknown>;
const receiver = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async request => new Response(await attempt(() => read(request))),
});
function served(cell: (request: Request) => Promise<unknown>, how: string, list: number[]): Promise<string> {
  read = cell;
  const bytes = Uint8Array.from(list);
  let answer = "";
  return new Promise(resolve => {
    Bun.connect({
      hostname: "127.0.0.1",
      port: receiver.port!,
      socket: {
        open(socket) {
          theRest = () => {
            for (const piece of framed(bytes, how)) socket.write(piece);
          };
          socket.write("POST / HTTP/1.1\r\nHost: a\r\n" + lengthOf(bytes, how) + "Connection: close\r\n\r\n");
        },
        data(socket, chunk) {
          answer += chunk.toString();
        },
        close() {
          resolve(answer.slice(answer.indexOf("\r\n\r\n") + 4));
        },
      },
    });
  });
}

async function cell0(holder: Request) {
  sendTheRest();
  return (await holder.json()) as Order;
}
async function cell1(holder: Request) {
  sendTheRest();
  return (await holder.json()) as Order | null;
}
async function cell2(holder: Request) {
  sendTheRest();
  return (await holder.json()) as unknown;
}
async function cell3(holder: Request) {
  sendTheRest();
  return await holder.json();
}
async function cell4(holder: Request) {
  sendTheRest();
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell5(holder: Request) {
  sendTheRest();
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell6(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.json()) as Order;
}
async function cell7(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.json()) as Order | null;
}
async function cell8(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.json()) as unknown;
}
async function cell9(holder: Request) {
  holder.body;
  sendTheRest();
  return await holder.json();
}
async function cell10(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell11(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell12(holder: Request) {
  sendTheRest();
  return (await holder.json()) as Order;
}
async function cell13(holder: Request) {
  sendTheRest();
  return (await holder.json()) as Order | null;
}
async function cell14(holder: Request) {
  sendTheRest();
  return (await holder.json()) as unknown;
}
async function cell15(holder: Request) {
  sendTheRest();
  return await holder.json();
}
async function cell16(holder: Request) {
  sendTheRest();
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell17(holder: Request) {
  sendTheRest();
  return (await holder.text().then(() => holder.json())) as Order;
}
async function cell18(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.json()) as Order;
}
async function cell19(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.json()) as Order | null;
}
async function cell20(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.json()) as unknown;
}
async function cell21(holder: Request) {
  holder.body;
  sendTheRest();
  return await holder.json();
}
async function cell22(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.json().then(() => holder.json())) as Order;
}
async function cell23(holder: Request) {
  holder.body;
  sendTheRest();
  return (await holder.text().then(() => holder.json())) as Order;
}
for (const [name, list] of contents) {
  const file = "holds-" + name.replaceAll(" ", "-").replaceAll(",", "");
  console.log(
    [
      name,
      "served, with a length",
      "",
      "order " + (await served(cell0, "counted", list)),
      "order or null " + (await served(cell1, "counted", list)),
      "unknown " + (await served(cell2, "counted", list)),
      "any " + (await served(cell3, "counted", list)),
      "twice " + (await served(cell4, "counted", list)),
      "behind text() " + (await served(cell5, "counted", list)),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "served, with a length",
      "body was read",
      "order " + (await served(cell6, "counted", list)),
      "order or null " + (await served(cell7, "counted", list)),
      "unknown " + (await served(cell8, "counted", list)),
      "any " + (await served(cell9, "counted", list)),
      "twice " + (await served(cell10, "counted", list)),
      "behind text() " + (await served(cell11, "counted", list)),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "served, chunked",
      "",
      "order " + (await served(cell12, "chunked", list)),
      "order or null " + (await served(cell13, "chunked", list)),
      "unknown " + (await served(cell14, "chunked", list)),
      "any " + (await served(cell15, "chunked", list)),
      "twice " + (await served(cell16, "chunked", list)),
      "behind text() " + (await served(cell17, "chunked", list)),
    ].join(" | "),
  );
  console.log(
    [
      name,
      "served, chunked",
      "body was read",
      "order " + (await served(cell18, "chunked", list)),
      "order or null " + (await served(cell19, "chunked", list)),
      "unknown " + (await served(cell20, "chunked", list)),
      "any " + (await served(cell21, "chunked", list)),
      "twice " + (await served(cell22, "chunked", list)),
      "behind text() " + (await served(cell23, "chunked", list)),
    ].join(" | "),
  );
}
await receiver.stop(true);
