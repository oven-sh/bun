// read() hands over one chunk at a time. Of a chunk that lies alone in the stream it takes the length that was counted at the push. A chunk whose memory was transferred, or that looks into a
// WebAssembly.Memory that has grown, has no bytes left: read() hands it over as it is now, the stream holds nothing more, and it ends. The lines are held to these, whoever runs the program.
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
const held = ["left 4 0", "transferred 0 0", "memory grown 0 0", "left 4 ended 0", "transferred 0 ended 0", "memory grown 0 ended 0"];
if (said.join() !== held.join()) throw new Error("the lines are held to: " + held.join("; "));
process.exit(0);
