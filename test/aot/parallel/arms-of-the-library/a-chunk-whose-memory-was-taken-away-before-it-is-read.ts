// read() hands over one chunk at a time and asks that chunk for its length. A chunk whose memory was transferred, or that looks into a WebAssembly.Memory that has grown, has no bytes left:
// read() then gives null and the stream goes on holding what it counted at the push, as in node 26. The lines are held to what node 26 prints, whoever runs the program.
import { Readable } from "node:stream";
const said: string[] = [];
const sizeOf = (value: any): string => (value === null ? "null" : String(value.length));
const make = (): Readable => new Readable({ read() {} });
function tell(name: string, bytes: Buffer, change: (bytes: Buffer) => void): void {
  const readable = make();
  readable.push(bytes);
  change(bytes);
  const first = sizeOf(readable.read());
  said.push(name + " " + first + " " + readable.readableLength);
}
async function tellOfEnd(name: string, bytes: Buffer, change: (bytes: Buffer) => void): Promise<void> {
  const readable = make();
  const told: string[] = [];
  readable.push(bytes);
  readable.push(null);
  change(bytes);
  const ended = (async () => {
    for await (const chunk of readable) told.push(sizeOf(chunk));
    return "ended";
  })();
  const stuck = new Promise<string>(resolve => setTimeout(resolve, 60, "stuck"));
  const how = await Promise.race([ended, stuck]);
  said.push(name + " " + (told.join(" ") || "nothing") + " " + how + " " + readable.readableLength);
}
const transfer = (bytes: Buffer): void => {
  structuredClone(bytes.buffer, { transfer: [bytes.buffer as ArrayBuffer] });
};
const fresh = (): Buffer => Buffer.from(new ArrayBuffer(4));
const grown = (): [Buffer, () => void] => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  return [Buffer.from(memory.buffer as ArrayBuffer, 8, 4), () => void memory.grow(1)];
};
tell("left", fresh(), () => {});
tell("transferred", fresh(), transfer);
tell("memory grown", ...grown());
await tellOfEnd("left", fresh(), () => {});
await tellOfEnd("transferred", fresh(), transfer);
await tellOfEnd("memory grown", ...grown());
console.log(said.join("\n"));
const asInNode = ["left 4 0", "transferred null 4", "memory grown null 4", "left 4 ended 0", "transferred nothing stuck 4", "memory grown nothing stuck 4"];
if (said.join() !== asInNode.join()) throw new Error("node 26 prints: " + asInNode.join("; "));
process.exit(0);
