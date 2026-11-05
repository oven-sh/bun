// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const bytes = Buffer.from("abc");
console.log(
  JSON.stringify(bytes),
  bytes.parent === bytes.buffer,
  typeof bytes.offset,
  Buffer.isBuffer(bytes),
  Buffer.from({ type: "Buffer", data: [1] })[0],
  Buffer.from(new String("s")).length,
);
