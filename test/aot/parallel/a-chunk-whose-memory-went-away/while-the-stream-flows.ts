import { Readable } from "node:stream";
const transfer = (bytes: Buffer): void => { structuredClone(bytes.buffer, { transfer: [bytes.buffer as ArrayBuffer] }); };
const fresh = (): Buffer => Buffer.from(new ArrayBuffer(4));
async function flowing(name: string, bytes: Buffer, ends: boolean, change: (bytes: Buffer) => void): Promise<void> {
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
  console.log(name, ends ? "ended" : "open", "|", told.join(" ") || "nothing", "|", readable.readableLength, readable.readableFlowing);
}
async function main(): Promise<void> {
  for (const ends of [false, true]) {
    await flowing("left", fresh(), ends, () => {});
    await flowing("transferred", fresh(), ends, transfer);
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
    await flowing("memory grown", Buffer.from(memory.buffer as any, 8, 4), ends, () => void memory.grow(1));
  }
  process.exit(0);
}
main();
