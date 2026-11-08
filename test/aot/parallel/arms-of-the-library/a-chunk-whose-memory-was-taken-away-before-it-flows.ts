// A stream that flows asks each chunk for its length before it hands it to the listeners. A chunk whose memory was transferred, or that looks into a WebAssembly.Memory that has grown, has no bytes left:
// nothing is handed over then, no end is told, and the stream goes on holding what it counted at the push, as in node 26. The lines are held to what node 26 prints, whoever runs the program.
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
const asInNode = [
  "left open | data 4 | 0 true",
  "transferred open | nothing | 4 true",
  "memory grown open | nothing | 4 true",
  "left ended | data 4 end close | 0 true",
  "transferred ended | nothing | 4 true",
  "memory grown ended | nothing | 4 true",
];
if (said.join("\n") !== asInNode.join("\n")) {
  console.error("node 26 prints:\n" + asInNode.join("\n"));
  process.exit(1);
}
process.exit(0);
