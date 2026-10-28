// Writes a program that reads bodies by json() which hold no JSON: no byte, a byte order mark alone, white space alone. What plain Bun answers hangs on who holds the body and on the road
// by which it reaches json(): null, or one of two errors. Each cell of the grid is a function of its own, so that the holder has its own type.
//
//   the bytes    none; the mark of UTF-8 and of UTF-16 in either order, alone; a space, a line end, all the white space of JSON; `null` alone, between spaces and behind either mark;
//                an object of the declared type
//   the holder   a Response and a Request of bytes, of a buffer, of a text, of a Blob, of a file, of nothing, of a stream of every kind, a clone; a Blob, a part of one, a file, a part of one, a file in a bucket;
//                a Response that was fetched and a Request that a server was handed, with a length, in chunks or until the connection ends, whose bytes arrive once json() has been called;
//                a Response and a Request of the body of such a Response, its Blob; a Response that was fetched from a data:, a blob: and a file: URL
//   the road     `body` was read first, or was not
//   the reader   json() into a declared type, into that type or null, into `unknown`, into no type; a second json() behind the first; json() behind text()

const contents: readonly (readonly [string, number[]])[] = [
  ["nothing", []],
  ["the mark of UTF-8", [0xef, 0xbb, 0xbf]],
  ["the mark of UTF-16", [0xff, 0xfe]],
  ["the mark of UTF-16, high byte first", [0xfe, 0xff]],
  ["a space", [0x20]],
  ["a line end", [0x0a]],
  ["all white space", [0x09, 0x0a, 0x0d, 0x20]],
  ["null", [...Buffer.from("null")]],
  ["null between spaces", [...Buffer.from(" null ")]],
  ["null behind the mark of UTF-8", [0xef, 0xbb, 0xbf, ...Buffer.from("null")]],
  ["null behind the mark of UTF-16", [0xff, 0xfe, ...Buffer.from("null", "utf16le")]],
  ["an order", [...Buffer.from('{"id":1,"name":"a"}')]],
];

const shared = `export {};
interface Order {
  id: number;
  name: string;
}
const contents: [string, number[]][] = ${JSON.stringify(contents)};
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
  return bytes.length ? [bytes.length.toString(16) + "\\r\\n", bytes, "\\r\\n0\\r\\n\\r\\n"] : ["0\\r\\n\\r\\n"];
}
const lengthOf = (bytes: Uint8Array, how: string) => (how === "chunked" ? "Transfer-Encoding: chunked\\r\\n" : how === "open" ? "" : "Content-Length: " + bytes.length + "\\r\\n");
`;

// The path ends in how the body is framed (counted, chunked, or open until the connection ends), when it is sent (now or later), and its bytes.
const sender = `const sender = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, request) {
      const [how, when, list] = request.toString("latin1").split(" ")[1].split("?")[0].split("/").slice(-3);
      const bytes = Uint8Array.from(list.split("-").filter(Boolean).map(Number));
      socket.write("HTTP/1.1 200 OK\\r\\n" + lengthOf(bytes, how) + "Connection: close\\r\\n\\r\\n");
      const rest = () => {
        for (const piece of framed(bytes, how)) socket.write(piece);
        socket.end();
      };
      if (when === "now") rest();
      else theRest = rest;
    },
  },
});
const from = (how: string, list: number[]) => "http://127.0.0.1:" + sender.port + "/" + how + "/later/-" + list.join("-");
const bucket = new Bun.S3Client({ endpoint: "http://127.0.0.1:" + sender.port, accessKeyId: "a", secretAccessKey: "b", bucket: "c" });
`;

// The server hands its request to the cell that is under way, and answers with what the cell says.
const receiver = `let read: (request: Request) => Promise<unknown>;
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
          socket.write("POST / HTTP/1.1\\r\\nHost: a\\r\\n" + lengthOf(bytes, how) + "Connection: close\\r\\n\\r\\n");
        },
        data(socket, chunk) {
          answer += chunk.toString();
        },
        close() {
          resolve(answer.slice(answer.indexOf("\\r\\n\\r\\n") + 4));
        },
      },
    });
  });
}
`;

const post = (body: string) => `new Request("http://localhost/", { method: "POST", body: ${body} })`;
const made: readonly (readonly [string, string])[] = [
  ["a response of bytes", "new Response(bytes)"],
  ["a response of a buffer", "new Response(bytes.buffer)"],
  ["a response of a view", "new Response(new DataView(bytes.buffer))"],
  ["a response of a text", "new Response(textOf(bytes))"],
  ["a response of a blob", "new Response(new Blob([bytes]))"],
  ["a response of a file", "new Response(Bun.file(file))"],
  ["a response of a stream", "new Response(streamOf(bytes))"],
  ["a response of a stream of bytes", `new Response(streamOf(bytes, "bytes"))`],
  ["a response of a late stream", "new Response(lateStreamOf(bytes))"],
  ["a response of a direct stream", "new Response(directStreamOf(bytes))"],
  ["a response of the stream of a blob", "new Response(new Blob([bytes]).stream())"],
  ["a response of the stream of a file", "new Response(Bun.file(file).stream())"],
  ["a response of a generator", "new Response(piecesOf(bytes) as any)"],
  ["a clone", "new Response(bytes).clone()"],
  ["a clone of a response of a stream", "new Response(streamOf(bytes)).clone()"],
  ["a request of bytes", post("bytes")],
  ["a request of a text", post("textOf(bytes)")],
  ["a request of a blob", post("new Blob([bytes])")],
  ["a request of a file", post("Bun.file(file)")],
  ["a request of a stream", post("streamOf(bytes)")],
  ["a request of a late stream", post("lateStreamOf(bytes)")],
  ["a clone of a request", post("bytes") + ".clone()"],
  ["a blob", "new Blob([bytes])"],
  ["a blob of a text", "new Blob([textOf(bytes)])"],
  ["a part of a blob", `new Blob(["ab", bytes]).slice(2)`],
  ["a file", "Bun.file(file)"],
  ["a part of a file", "Bun.file(file).slice(0)"],
];
// These hold nothing whatever the bytes are.
const madeOfNothing: readonly (readonly [string, string])[] = [
  ["a response of nothing", "new Response()"],
  ["a response of null", "new Response(null)"],
  ["a request without a body", `new Request("http://localhost/")`],
  ["a blob of nothing", "new Blob()"],
];
const fetched: readonly (readonly [string, string])[] = [
  ["fetched, with a length", `await fetch(from("counted", list))`],
  ["fetched, chunked", `await fetch(from("chunked", list))`],
  ["fetched, until the end", `await fetch(from("open", list))`],
  ["a clone of what was fetched", `(await fetch(from("chunked", list))).clone()`],
  ["a response of the body of what was fetched", `new Response((await fetch(from("chunked", list))).body)`],
  ["a request of the body of what was fetched", post(`(await fetch(from("chunked", list))).body`)],
  ["a blob of what was fetched", `await fetch(from("chunked", list)).then(response => (sendTheRest(), response.blob()))`],
  ["fetched from a data: URL", `await fetch("data:application/json;base64," + btoa(textOf(bytes)))`],
  ["fetched from a blob: URL", `await fetch(URL.createObjectURL(new Blob([bytes])))`],
  ["fetched from a file: URL", `await fetch(Bun.pathToFileURL(file))`],
  ["a file in a bucket", `bucket.file("counted/now/-" + list.join("-"))`],
];

const readers: readonly (readonly [string, string])[] = [
  ["order", "(await holder.json()) as Order"],
  ["order or null", "(await holder.json()) as Order | null"],
  ["unknown", "(await holder.json()) as unknown"],
  ["any", "await holder.json()"],
  ["twice", "(await holder.json().then(() => holder.json())) as Order"],
  ["behind text()", "(await holder.text().then(() => holder.json())) as Order"],
];

const hasBody = (holder: string) => !/^a (blob|file|part)\b/.test(holder);

export const parts = ["made", "fetched", "served"] as const;

export function writeTheProgram(part: (typeof parts)[number]): string {
  const functions: string[] = [];
  const rows: string[] = [];
  const rowsOfNothing: string[] = [];
  const row = (into: string[], holder: string, road: string, cells: string[]) =>
    into.push(`  console.log([name, ${JSON.stringify(holder)}, ${JSON.stringify(road)}, ${cells.join(", ")}].join(" | "));`);
  const grid = (holders: readonly (readonly [string, string])[], into: string[]) => {
    for (const [holder, make] of holders) {
      for (const road of hasBody(holder) ? ["", "body was read"] : [""]) {
        const cells = readers.map(([reader, read]) => {
          const cell = `cell${functions.length}`;
          // Not every declaration of Blob has a json(), so TypeScript is told to pass over the line that reads.
          functions.push(
            part === "served"
              ? `async function ${cell}(holder: Request) {\n${road && "  holder.body;\n"}  sendTheRest();\n  return ${read};\n}`
              : `async function ${cell}(list: number[], file: string) {\n  const bytes = Uint8Array.from(list);\n  const holder = ${make};\n${road && "  holder.body;\n"}  sendTheRest();\n  // @ts-ignore\n  return ${read};\n}`,
          );
          return part === "served"
            ? `${JSON.stringify(reader + " ")} + (await served(${cell}, ${JSON.stringify(make)}, list))`
            : `${JSON.stringify(reader + " ")} + (await attempt(() => ${cell}(list, file)))`;
        });
        row(into, holder, road, cells);
      }
    }
  };
  if (part === "made") {
    grid(made, rows);
    grid(madeOfNothing, rowsOfNothing);
  } else if (part === "fetched") grid(fetched, rows);
  else
    grid(
      [
        ["served, with a length", "counted"],
        ["served, chunked", "chunked"],
      ],
      rows,
    );

  return [
    shared,
    part === "fetched" ? sender : part === "served" ? receiver : "",
    ...functions,
    `for (const [name, list] of contents) {`,
    `  const file = "holds-" + name.replaceAll(" ", "-").replaceAll(",", "");`,
    part === "served" ? "" : `  await Bun.write(file, Uint8Array.from(list));`,
    ...rows,
    `}`,
    rowsOfNothing.length ? `{\n  const name = "nothing", list: number[] = [], file = "";\n${rowsOfNothing.join("\n")}\n}` : "",
    part === "fetched" ? "sender.stop(true);" : part === "served" ? "await receiver.stop(true);" : "",
    "",
  ]
    .filter(line => line !== "")
    .join("\n");
}

if (import.meta.main) process.stdout.write(writeTheProgram(process.argv[2] as (typeof parts)[number]));
