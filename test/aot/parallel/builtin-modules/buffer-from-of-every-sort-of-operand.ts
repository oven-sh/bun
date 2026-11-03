// Buffer.from of every sort of operand: each way through it ends in a Buffer or throws, and the functions of an operand that only it calls are in the program.
const say = (...values: unknown[]) => console.log(...values);
const show = (made: Buffer) => `${made instanceof Buffer} ${made.length} ${made.toString("hex")}`;
say(show(Buffer.from("ab")), show(Buffer.from("6162", "hex")), show(Buffer.from([1, 2, 300])), show(Buffer.from(new Uint16Array([1, 258]))), show(Buffer.from(Buffer.from("x"))));
const shared = new ArrayBuffer(4); const view = Buffer.from(shared, 1, 2); view[0] = 7; say(show(view), new Uint8Array(shared).join(), view.buffer === shared);
say(show(Buffer.from({ valueOf() { say("valueOf ran"); return "from valueOf"; } } as any)), show(Buffer.from(new String("wrapped") as any)));
const behind = new ArrayBuffer(2); const through = Buffer.from({ valueOf: () => behind } as any); through[1] = 9; say(new Uint8Array(behind).join(), through.buffer === behind);
say(show(Buffer.from({ length: 2, 0: 5, 1: 6 } as any)), show(Buffer.from({ length: -1 } as any)), show(Buffer.from({ length: "2" } as any)), show(Buffer.from({ type: "Buffer", data: [1, 2] } as any)), show(Buffer.from({ type: "Buffer", data: [] } as any)));
say(show(Buffer.from({ [Symbol.toPrimitive](hint: string) { say("toPrimitive ran with", hint); return "primitive"; } } as any)));
say(show(Buffer.from({ get length() { say("the getter of length ran"); return 1; }, 0: 65 } as any)), show(JSON.parse(JSON.stringify(Buffer.from("json")), (key, value) => (value && value.type === "Buffer" ? Buffer.from(value) : value))));
say(show(new (Buffer.from as any)("constructed")), Buffer.concat([Buffer.from("a"), Buffer.from("b")]).toString(), Buffer.from("hex").toString("hex"), Buffer.from("text").toString("base64"));
for (const refused of [undefined, null, 1, true, Symbol("s"), {}, () => 1, { valueOf: () => 1 }, { [Symbol.toPrimitive]: () => 1 }])
  try { say(show(Buffer.from(refused as any))); } catch (e) { say((e as any).code, (e as Error).name); }
