const { Readable, Writable } = require("node:stream");
async function read(count) {
  let next = 0,
    sum = 0;
  const readable = new Readable({
    objectMode: true,
    read() {
      this.push(next < count ? { value: next++ } : null);
    },
  });
  for await (const { value } of readable) {
    sum += value;
    if ((value & 32767) === 32767) Bun.gc(true);
  }
  return sum;
}
function make(count) {
  let sum = 0;
  for (let i = 0; i < count; i++)
    sum += new Readable({ read() {} }).readableHighWaterMark + new Writable({ write() {} }).writableHighWaterMark;
  return sum;
}
function burst(count) {
  let ran = 0;
  const { promise, resolve } = Promise.withResolvers();
  const tick = () => {
    if (++ran === count) resolve(ran);
  };
  for (let i = 0; i < count; i++) process.nextTick(tick);
  return promise;
}
(async () => {
  await 1;
  const sum = await read(150000);
  Bun.gc(true);
  const made = make(30000);
  const ran = await burst(300000);
  Bun.gc(true);
  console.log(sum, made, ran, make(30000));
})();
