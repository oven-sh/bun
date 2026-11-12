function show(run: () => unknown): string { try { const value = run(); return typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value); } catch (error: any) { return String(error.code ?? error.name); } }
function pattern(length: number): Buffer { const made = Buffer.alloc(length); for (let i = 0; i < length; i++) made[i] = (i * 37 + 11) & 255; return made; }
function bytesOf(view: Uint8Array): string { let text = ""; for (let i = 0; i < view.length; i++) text += view[i].toString(16).padStart(2, "0"); return text; }
const lines: string[] = [];
const NAME = "writeInt16BE";
const target = Buffer.alloc(16);
const resizable = new (ArrayBuffer as any)(16, { maxByteLength: 32 });
function access(buf: Buffer, offset: number) { return buf.writeInt16BE(258, offset); }
function inLoop(buf: Buffer, deedAt: number, deed: (buf: any) => void): void { for (let turn = 0; turn < 6; turn++) { if (turn === deedAt) deed(buf); lines.push(show(() => access(buf, turn & 3))); } }
function fill(buf: Buffer): Buffer { for (let i = 0; i < buf.length; i++) buf[i] = (i * 37 + 11) & 255; return buf; }
for (let round = 0; round < 3; round++) { const untouched = fill(Buffer.from(new ArrayBuffer(16))); inLoop(untouched, -1, () => {}); }
const victim = fill(Buffer.from(new ArrayBuffer(16)));
inLoop(victim, 3, (buf: any) => { buf.buffer.transfer(); });
inLoop(victim, -1, () => {});
lines.push(bytesOf(target));
console.log(lines.join("\n"));
