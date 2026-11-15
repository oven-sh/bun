// An accessor of the program under statusMessage, which a response does not hold until it is stored, answers another text than what is stored: a text of its own, or what was stored with a tail. writeHead() looks at what reads back, and that goes on the wire, as without compilation.
import http from "node:http";
const lines = [];
let row = [];
const calls = {
  "a reason": res => res.writeHead(200, "fine"),
  "a reason and headers": res => res.writeHead(200, "fine", { "x-made-up": "1" }),
  "headers alone": res => res.writeHead(200, { "x-made-up": "1" }),
  "a code alone": res => res.writeHead(200),
  "no writeHead": res => res,
};
const server = http.createServer((req, res) => {
  const [call, answer] = row;
  let stored;
  Object.defineProperty(res, "statusMessage", {
    configurable: true,
    get() {
      return typeof answer === "object" ? stored : answer;
    },
    set(value) {
      if (typeof answer === "object") stored = value + answer.tail;
    },
  });
  let line;
  try {
    calls[call](res);
    line = "returns";
  } catch (error) {
    line = `throws ${error.code} . headers ${JSON.stringify(res.getHeaders())} . code ${res.statusCode}`;
  }
  try {
    res.end("k");
  } catch (error) {
    line += ` . end() throws ${error.code}`;
    res.destroy();
  }
  lines.push(`${call} . ${JSON.stringify(answer)}: ${line}`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
for (const call of Object.keys(calls)) {
  for (const answer of ["two\nlines", "Other", "", undefined, { tail: "\n" }, { tail: " more" }, { tail: "" }]) {
    row = [call, answer];
    const seen = await new Promise(resolve =>
      http
        .get({ host: "127.0.0.1", port: server.address().port, agent: false }, got =>
          got
            .resume()
            .on("end", () =>
              resolve(`${got.statusCode} ${JSON.stringify(got.statusMessage)} ${got.headers["x-made-up"]}`),
            ),
        )
        .on("error", error => resolve(`no answer ${error.code}`)),
    );
    lines[lines.length - 1] += ` | ${seen}`;
  }
}
await new Promise(resolve => server.close(resolve));
console.log(lines.join("\n"));
