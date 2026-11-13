function show(run: () => unknown): string { try { const value = run(); return typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value); } catch (error: any) { return String(error.code ?? error.name); } }
function pattern(length: number): Buffer { const made = Buffer.alloc(length); for (let i = 0; i < length; i++) made[i] = (i * 37 + 11) & 255; return made; }
function bytesOf(view: Uint8Array): string { let text = ""; for (let i = 0; i < view.length; i++) text += view[i].toString(16).padStart(2, "0"); return text; }
const lines: string[] = [];
const NAME = "readUInt32LE";
const target = Buffer.alloc(16);
function access(buf: Buffer, offset: number) { return buf.readUInt32LE(offset); }
const odd: any = new DataView(new ArrayBuffer(16));
for (let turn = 0; turn < 8; turn++) { lines.push(show(() => access(Buffer.alloc(16, turn + 1), turn & 3))); if (turn >= 4) lines.push(show(() => access(odd, turn & 3))); }
lines.push(bytesOf(target));
console.log(lines.join("\n"));
