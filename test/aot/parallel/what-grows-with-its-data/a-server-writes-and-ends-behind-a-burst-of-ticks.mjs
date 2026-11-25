// A burst of ticks that queue ticks, and behind it exchanges with a server that writes and ends. What an exchange costs must not hang on how large the burst was.
// Sizes: 16000 64000 256000
// Passes: 2
// Grows: linear
import http from "node:http";
const size = Number(process.env.SIZE ?? 1600),
  passes = Number(process.env.PASSES ?? 1);
const nothing = () => {};
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(resolve => setImmediate(resolve));
};
const server = http.createServer((request, response) => {
  response.write("o");
  response.end("k");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const exchange = () =>
  new Promise((resolve, reject) => {
    http
      .get({ port: server.address().port, host: "127.0.0.1", path: "/", agent }, response => {
        let text = "";
        response.on("data", chunk => (text += chunk));
        response.on("end", () => resolve(text));
      })
      .on("error", reject);
  });
async function once() {
  for (let tick = 0; tick < size; tick++) process.nextTick(() => process.nextTick(nothing));
  await turns(3);
  let right = 0;
  for (let at = 0; at < size / 256; at++) if ((await exchange()) === "ok") right++;
  return right;
}
let told = 0;
for (let pass = 0; pass < passes; pass++) told = await once();
console.log(told);
agent.destroy();
server.close();
