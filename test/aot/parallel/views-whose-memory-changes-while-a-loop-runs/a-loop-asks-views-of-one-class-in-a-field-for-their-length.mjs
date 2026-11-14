import { Worker, isMainThread, workerData } from "node:worker_threads";
function Context() {
  this.kept = 0;
  this.createImage = function (memory) { var result = {}; result.data = new Uint8Array(memory); return result; };
  this.hash = function (image) { var sum = 0; for (var i = 0; i < image.data.length; i++) { sum ^= (i * image.data[i]) | 0; } this.kept ^= sum; return sum; };
  this.fill = function (image, value) { for (var i = 0; i < image.data.length; ++i) { image.data[i] = value + i; } };
  this.spin = function (image) { var sum = 0; for (var i = 0; i < image.data.length; i += image.data.length === 4 ? 0 : 1) { sum = (sum + image.data[i]) & 0xff; } return i; };
}
Context.prototype.act = function (image, at, what) { var seen = []; for (var i = 0; i < image.data.length; i++) { if (i === at) what(image); seen.push(image.data[i]); if (seen.length > 40) break; } return seen.join(); };
if (isMainThread) {
  globalThis.seen = [Context, findValue("context")];
  const context = new Context();
  const image = context.createImage(12);
  for (let i = 0; i < 300; i++) { context.fill(image, i); context.hash(image); }
  console.log(context.kept, context.hash(image));
  const follows = context.createImage(new ArrayBuffer(8, { maxByteLength: 64 }));
  context.fill(follows, 5);
  console.log(context.hash(follows));
  follows.data.buffer.resize(20);
  context.fill(follows, 9);
  console.log(context.hash(follows), context.act(follows, 2, image => image.data.buffer.resize(5)), context.hash(follows));
  console.log(context.act(follows, 2, image => image.data.buffer.resize(11)), context.hash(follows));
  const handed = context.createImage(6);
  context.fill(handed, 1);
  console.log(context.act(handed, 2, image => image.data.buffer.transfer()), context.hash(handed));
  console.log(context.act(context.createImage(3), 1, image => { image.data = context.createImage(5).data; }));
  const grows = context.createImage(new SharedArrayBuffer(4, { maxByteLength: 64 }));
  context.fill(grows, 3);
  console.log(context.hash(grows), context.act(grows, 2, image => { if (image.data.length < 10) image.data.buffer.grow(10); }), context.hash(grows));
  const shared = new SharedArrayBuffer(4, { maxByteLength: 64 });
  const waits = context.createImage(shared);
  for (let i = 0; i < 300; i++) context.hash(waits);
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  console.log(context.spin(waits), context.hash(waits));
  await worker.terminate();
  delete image.data;
  try { console.log(context.hash(image)); } catch (error) { console.log(error instanceof TypeError); }
} else {
  setTimeout(() => workerData.grow(8), 100);
}
function findValue(name) { return globalThis[name]; }
