import { Worker, isMainThread, workerData } from "node:worker_threads";
function Context(size) { this.image = { data: new Uint8Array(size) }; this.kept = 0; }
Context.prototype.hash = function (image) { var sum = 0; for (var i = 0; i < image.data.length; i++) { sum ^= (i * image.data[i]) | 0; } this.kept ^= sum; return sum; };
Context.prototype.fill = function (image, value) { for (var i = 0; i < image.data.length; ++i) { image.data[i] = value + i; } };
function hash(holder) { var sum = 0; for (var i = 0; i < holder.data.length; i++) sum ^= (i * holder.data[i]) | 0; return sum; }
function count(holder) { var turns = 0; for (var i = 0; i < holder.data.length; i++) turns += 1; return turns; }
function act(holder, at, what) { var seen = []; for (var i = 0; i < holder.data.length; i++) { if (i === at) what(holder); seen.push(holder.data[i]); if (seen.length > 40) break; } return seen.join(); }
function spin(holder) { var turns = 0; while (holder.data.length === 4) turns++; return turns > 0; }
function spinUnderCounter(holder) { var last = 0; for (var i = 0; i < holder.data.length + 100; i = holder.data.length === 4 ? i : i + 100) last = i; return last >= 0; }
if (isMainThread) {
  globalThis.seen = eval("[Context, hash, count, act]").length;
  const context = new Context(12);
  for (let i = 0; i < 300; i++) { context.fill(context.image, i); context.hash(context.image); }
  console.log(context.kept, context.hash(context.image), hash(context.image), count(context.image));
  const follows = { data: new Uint8Array(new ArrayBuffer(8, { maxByteLength: 64 })) };
  context.fill(follows, 5);
  console.log(hash(follows), count(follows));
  follows.data.buffer.resize(20);
  context.fill(follows, 9);
  console.log(hash(follows), context.hash(follows), count(follows));
  console.log(act(follows, 2, holder => holder.data.buffer.resize(5)), count(follows));
  console.log(act(follows, 2, holder => holder.data.buffer.resize(11)), count(follows));
  const handed = { data: Uint8Array.of(1, 2, 3, 4, 5) };
  console.log(act(handed, 2, holder => holder.data.buffer.transfer()), count(handed), hash(handed));
  const other = { data: Uint8Array.of(1, 2, 3, 4, 5) };
  console.log(act(other, 2, holder => { holder.data = Uint8Array.of(7, 8, 9); }), hash(other));
  console.log(act(other, 1, holder => { holder.data = [4, 5, 6, 7]; }), hash(other), count(other));
  const grows = { data: new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 64 })) };
  context.fill(grows, 3);
  console.log(hash(grows), act(grows, 2, holder => { if (holder.data.length < 10) holder.data.buffer.grow(10); }), count(grows));
  console.log(hash({ data: Buffer.from("a buffer") }), count({ data: Buffer.from("a buffer") }));
  class Short extends Uint8Array { get length() { return 2; } }
  console.log(hash({ data: new Short([9, 8, 7, 6]) }), count({ data: new Short([9, 8, 7, 6]) }));
  console.log(hash({ data: "text" }), count({ data: "text" }), count({ data: { length: 3 } }), count({ data: new Float64Array(4) }));
  const shared = new SharedArrayBuffer(4, { maxByteLength: 64 });
  const waits = { data: new Uint8Array(shared) };
  for (let i = 0; i < 300; i++) count(waits);
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  console.log(spin(waits), spinUnderCounter(waits), count(waits), hash(waits));
  await worker.terminate();
  const taken = { data: new Uint8Array(3) };
  delete taken.data;
  for (const read of [hash, count, holder => context.hash(holder), holder => context.fill(holder, 1), holder => act(holder, 9, () => {})]) {
    try { console.log(read(taken)); } catch (error) { console.log(error instanceof TypeError); }
  }
  delete context.image.data;
  try { console.log(context.hash(context.image)); } catch (error) { console.log(error instanceof TypeError); }
  context.image.data = new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 64 }));
  console.log(context.hash(context.image), count(context.image));
} else {
  setTimeout(() => workerData.grow(8), 100);
}
