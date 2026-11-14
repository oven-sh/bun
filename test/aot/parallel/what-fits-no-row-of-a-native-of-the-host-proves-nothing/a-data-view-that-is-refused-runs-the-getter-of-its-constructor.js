// Buffer.copyBytesFrom() refuses a DataView and describes it in the error, which reads `constructor` off it: what the getter stores is seen after the call.
const box = { n: 1 };
const view = new DataView(new ArrayBuffer(1));
Object.defineProperty(view, "constructor", { get() { box.n = "two"; return DataView; } });
function run() {
  box.n = 1;
  const before = box.n + 1;
  try { Buffer.copyBytesFrom(view); } catch {}
  return before + "," + (box.n + 1);
}
for (let i = 0; i < 3; i++) console.log(run());
