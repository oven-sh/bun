// An accessor of the program over _events puts a process.nextTick of the program's own in place at its first read amid end(), and the handler takes it away behind end(): it is handed the tick that the full road queues behind that read.
import http from "node:http";
const log = [];
const server = http.createServer((req, res) => {
  const own = res._events, original = process.nextTick, seen = [];
  let reads = 0;
  Object.defineProperty(res, "_events", {
    configurable: true,
    get() {
      if (++reads === 1) {
        process.nextTick = function (job, ...rest) {
          seen.push(job.name);
          return original.call(process, job, ...rest);
        };
      }
      return own;
    },
    set(value) {},
  });
  res.end("ok");
  process.nextTick = original;
  log.push(`handed: ${seen.join()}`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (let turn = 0; turn < 3; turn++) log.push(await (await fetch(url)).text());
await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
