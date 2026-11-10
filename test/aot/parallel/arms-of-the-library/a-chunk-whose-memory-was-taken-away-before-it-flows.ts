// A stream that flows takes, of a chunk that lies alone in it, the length that was counted at the push. A chunk whose memory was transferred, or that looks into a WebAssembly.Memory that has grown, has no
// bytes left: it is handed to the listeners as it is now, the stream holds nothing more, and the end is told. The lines are held to these, whoever runs the program.
import { Readable } from "node:stream";
const said: string[] = [];
const transfer = (bytes: Buffer): void => {
  structuredClone(bytes.buffer, { transfer: [bytes.buffer as ArrayBuffer] });
};
const fresh = (): Buffer => Buffer.from(new ArrayBuffer(4));
const grown = (): [Buffer, () => void] => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  return [Buffer.from(memory.buffer as ArrayBuffer, 8, 4), () => void memory.grow(1)];
};
async function flow(name: string, ends: boolean, bytes: Buffer, change: (bytes: Buffer) => void): Promise<void> {
  const readable = new Readable({ read() {} });
  const told: string[] = [];
  readable.push(bytes);
  if (ends) readable.push(null);
  change(bytes);
  readable.on("data", chunk => told.push("data " + chunk.length));
  readable.on("end", () => told.push("end"));
  readable.on("close", () => told.push("close"));
  readable.on("error", error => told.push("error " + error.name));
  await new Promise(resolve => setTimeout(resolve, 60));
  said.push([name, ends ? "ended" : "open", "|", told.join(" ") || "nothing", "|", readable.readableLength, readable.readableFlowing].join(" "));
}
for (const ends of [false, true]) {
  await flow("left", ends, fresh(), () => {});
  await flow("transferred", ends, fresh(), transfer);
  await flow("memory grown", ends, ...grown());
}
console.log(said.join("\n"));
const held = [
  "left open | data 4 | 0 true",
  "transferred open | data 0 | 0 true",
  "memory grown open | data 0 | 0 true",
  "left ended | data 4 end close | 0 true",
  "transferred ended | data 0 end close | 0 true",
  "memory grown ended | data 0 end close | 0 true",
];
if (said.join("\n") !== held.join("\n")) {
  console.error("the lines are held to:\n" + held.join("\n"));
  process.exit(1);
}
process.exit(0);
