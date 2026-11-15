import { createServer } from "node:http";

const answers = [];
process.on("uncaughtException", error => answers.push("escaped " + (error.code ?? error.message)));
for (const throws of [false, true]) {
  const server = createServer((request, response) => {
    let armed = throws;
    const held = request._destroy;
    Object.defineProperty(request, "_destroy", {
      get() {
        if (armed) {
          armed = false;
          response.setHeader("x-late", "1");
        }
        return held;
      },
      configurable: true,
    });
    request.on("data", chunk => answers.push("data " + chunk));
    request.on("end", () => response.end("read"));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/", { method: "POST", body: "posted" });
  answers.push(answer.status + " " + (await answer.text()));
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => setTimeout(resolve, 50));
}
console.log(answers.join("\n"));
