// Methods found through instances: each function here becomes the toJSON of an object in another way, most of them by native code, and JSON.stringify then calls it with the key, a string, while the program calls it with a number. A bit is set for each function that saw the string.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

function byLiteral(scale: number): number { if (typeof scale !== "number") bits |= 1; return 0; }
function byStore(scale: number): number { if (typeof scale !== "number") bits |= 2; return 0; }
function byAssign(scale: number): number { if (typeof scale !== "number") bits |= 4; return 0; }
function byDefine(scale: number): number { if (typeof scale !== "number") bits |= 8; return 0; }
function byDefineGetter(scale: number): number { if (typeof scale !== "number") bits |= 16; return 0; }
function byDefineMany(scale: number): number { if (typeof scale !== "number") bits |= 32; return 0; }
function byFromEntries(scale: number): number { if (typeof scale !== "number") bits |= 64; return 0; }
function byCreate(scale: number): number { if (typeof scale !== "number") bits |= 128; return 0; }
function byCreateWith(scale: number): number { if (typeof scale !== "number") bits |= 256; return 0; }
function byReflectSet(scale: number): number { if (typeof scale !== "number") bits |= 512; return 0; }
function bySetPrototype(scale: number): number { if (typeof scale !== "number") bits |= 1024; return 0; }
function byDunderProto(scale: number): number { if (typeof scale !== "number") bits |= 2048; return 0; }
function byProxy(scale: number): number { if (typeof scale !== "number") bits |= 4096; return 0; }
function bySpread(scale: number): number { if (typeof scale !== "number") bits |= 8192; return 0; }
function byEntriesLoop(scale: number): number { if (typeof scale !== "number") bits |= 16384; return 0; }
function byClassField(scale: number): number { if (typeof scale !== "number") bits |= 32768; return 0; }
function byPrototypeStore(scale: number): number { if (typeof scale !== "number") bits |= 65536; return 0; }
function byPrototypeAssign(scale: number): number { if (typeof scale !== "number") bits |= 131072; return 0; }
function byBound(scale: number): number { if (typeof scale !== "number") bits |= 262144; return 0; }
function byMapValue(scale: number): number { if (typeof scale !== "number") bits |= 524288; return 0; }
function byReflectDefine(scale: number): number { if (typeof scale !== "number") bits |= 1048576; return 0; }
function byStaticBlock(scale: number): number { if (typeof scale !== "number") bits |= 2097152; return 0; }
function byArrayProperty(scale: number): number { if (typeof scale !== "number") bits |= 4194304; return 0; }
function byFunctionProperty(scale: number): number { if (typeof scale !== "number") bits |= 8388608; return 0; }

byLiteral(1);
attempt(() => JSON.stringify({ toJSON: byLiteral }));
byStore(1);
attempt(() => { const holder: any = {}; holder.toJSON = byStore; return JSON.stringify(holder); });
byAssign(1);
attempt(() => JSON.stringify(Object.assign({}, { toJSON: byAssign })));
byDefine(1);
attempt(() => JSON.stringify(Object.defineProperty({}, "toJSON", { value: byDefine })));
byDefineGetter(1);
attempt(() => JSON.stringify(Object.defineProperty({}, "toJSON", { get: () => byDefineGetter })));
byDefineMany(1);
attempt(() => JSON.stringify(Object.defineProperties({}, { toJSON: { value: byDefineMany } })));
byFromEntries(1);
attempt(() => JSON.stringify(Object.fromEntries([["toJSON", byFromEntries]])));
byCreate(1);
attempt(() => JSON.stringify(Object.create({ toJSON: byCreate })));
byCreateWith(1);
attempt(() => JSON.stringify(Object.create(null, { toJSON: { value: byCreateWith } })));
byReflectSet(1);
attempt(() => { const holder = {}; Reflect.set(holder, "toJSON", byReflectSet); return JSON.stringify(holder); });
bySetPrototype(1);
attempt(() => JSON.stringify(Object.setPrototypeOf({}, { toJSON: bySetPrototype })));
byDunderProto(1);
attempt(() => JSON.stringify({ __proto__: { toJSON: byDunderProto } }));
byProxy(1);
attempt(() => JSON.stringify(new Proxy({}, { get: () => byProxy })));
bySpread(1);
attempt(() => JSON.stringify({ ...{ toJSON: bySpread } }));
byEntriesLoop(1);
attempt(() => { const holder: any = {}; for (const [key, value] of Object.entries({ toJSON: byEntriesLoop })) holder[key] = value; return JSON.stringify(holder); });
byClassField(1);
attempt(() => JSON.stringify(new (class { toJSON = byClassField; })()));
byPrototypeStore(1);
attempt(() => { class Holder {} (Holder.prototype as any).toJSON = byPrototypeStore; return JSON.stringify(new Holder()); });
byPrototypeAssign(1);
attempt(() => { class Holder {} Object.assign(Holder.prototype, { toJSON: byPrototypeAssign }); return JSON.stringify(new Holder()); });
byBound(1);
attempt(() => JSON.stringify({ toJSON: byBound.bind(null) }));
byMapValue(1);
attempt(() => JSON.stringify({ toJSON: new Map([["f", byMapValue]]).get("f") }));
byReflectDefine(1);
attempt(() => { const holder = {}; Reflect.defineProperty(holder, "toJSON", { value: byReflectDefine }); return JSON.stringify(holder); });
byStaticBlock(1);
attempt(() => JSON.stringify(new (class Holder { static { (Holder.prototype as any).toJSON = byStaticBlock; } })()));
byArrayProperty(1);
attempt(() => JSON.stringify(Object.assign([1], { toJSON: byArrayProperty })));
byFunctionProperty(1);
attempt(() => JSON.stringify({ k: Object.assign(() => 0, { toJSON: byFunctionProperty }) }));
console.log(bits.toString(2));
