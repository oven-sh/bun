import http from "node:http";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const bun = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/generator")
      return new Response(
        (async function* () {
          for (let i = 0; i < 3; i++) {
            await wait(1);
            yield "part " + i + "\n";
          }
        })(),
      );
    if (pathname === "/events") {
      let n = 0;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (n === 3) return controller.close();
            controller.enqueue(new TextEncoder().encode("data: " + n++ + "\n\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    return new Response(request.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({ transform: (piece, controller) => controller.enqueue(piece.toUpperCase()) })).pipeThrough(new TextEncoderStream()));
  },
});
console.log(JSON.stringify(await (await fetch(bun.url + "generator")).text()));
const reader = (await fetch(bun.url + "events")).body.pipeThrough(new TextDecoderStream()).getReader();
let events = "";
for (let step = await reader.read(); !step.done; step = await reader.read()) events += step.value;
console.log(JSON.stringify(events));
console.log(await (await fetch(bun.url + "upper", { method: "POST", body: "make this loud" })).text());
bun.stop(true);

const node = http.createServer(async (request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  for (let i = 0; i < 3; i++) {
    response.write("row " + i + "\n");
    await wait(1);
  }
  response.addTrailers?.({});
  response.end(() => console.log("answer sent", response.writableEnded, response.headersSent));
});
node.listen(0, "127.0.0.1", async () => {
  const answer = await fetch("http://127.0.0.1:" + node.address().port);
  let rows = "";
  for await (const piece of answer.body) rows += new TextDecoder().decode(piece);
  console.log(JSON.stringify(rows), answer.headers.get("transfer-encoding"), answer.headers.get("content-length"));
  node.close();
});
