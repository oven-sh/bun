// Folded calls: visible accessors3. It prints what plain Bun prints.
const { Readable, Writable } = require("node:stream");
for (const [name, C] of [["Readable.ReadableState", Readable.ReadableState], ["Writable.WritableState", Writable.WritableState]]) {
  const attempt = f => { try { const r = f(); return "allowed (" + typeof r + ")"; } catch (e) { return e.constructor.name; } };
  console.log(name, typeof C, "| length", C?.length, "| new:", attempt(() => new C({}, undefined, false)), "| call without new on a plain object:", attempt(() => C.call({}, {}, undefined, false)), "| instanceof of a stream's state:", (name[0] === "R" ? new Readable({ read() {} })._readableState : new Writable({ write() {} })._writableState) instanceof C);
}
