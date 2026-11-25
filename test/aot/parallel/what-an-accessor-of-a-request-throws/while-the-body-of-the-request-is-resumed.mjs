// A request holds an accessor of the program's under one of the methods that a stream calls on itself. It throws the first time that it is asked, or counts how often it is asked.
import { createServer } from "node:http";

const answers = [];
process.on("uncaughtException", error => answers.push("escaped " + (error.code ?? error.message)));
for (const name of ["_read", "read", "_destroy", "destroy"]) {
  for (const throws of [false, true]) {
    let asked = 0;
    const server = createServer((request, response) => {
      let armed = throws;
      const held = request[name];
      Object.defineProperty(request, name, {
        get() {
          asked++;
          if (armed) {
            armed = false;
            throw new Error("the accessor under " + name + " throws");
          }
          return held;
        },
        configurable: true,
      });
      request.on("error", error => answers.push("the request emits error: " + error.message));
      request.on("close", () => answers.push("the request closes"));
      try {
        request.on("data", chunk => answers.push("data " + chunk));
        request.on("end", () => response.end("read"));
      } catch (error) {
        answers.push("thrown at the listener: " + error.message);
        response.end("not read");
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const answer = await fetch("http://127.0.0.1:" + server.address().port + "/", {
      method: "POST",
      body: "posted",
    }).then(
      async it => it.status + " " + (await it.text()),
      error => "no answer: " + (error.code ?? error.name),
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    answers.push(name + (throws ? ", throws once" : ", only answers") + ": " + answer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
console.log(answers.join("\n"));
