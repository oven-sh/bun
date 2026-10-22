import http from "node:http";

const server = http.createServer((request, response) => {
  let size = 0;
  request.setEncoding("utf8");
  request.on("data", text => (size += text.length));
  request.on("end", () => {
    response.writeHead(request.url === "/teapot" ? 418 : 200, { "content-type": "text/plain", "x-method": request.method });
    response.write("got " + size + " characters");
    response.end(" on " + request.url);
  });
});

function ask(options, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port: server.address().port, agent: false, ...options }, response => {
      const parts = [];
      response.on("data", part => parts.push(part));
      response.on("end", () => resolve({ status: response.statusCode, message: response.statusMessage, method: response.headers["x-method"], text: Buffer.concat(parts).toString() }));
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

server.listen(0, "127.0.0.1", async () => {
  console.log(await ask({ path: "/first" }));
  console.log(await ask({ path: "/second", method: "PUT", headers: { "content-type": "text/plain" } }, "twelve chars"));
  console.log(await ask({ path: "/teapot", method: "POST" }, Buffer.from("abc")));
  http.get({ host: "127.0.0.1", port: server.address().port, path: "/get", agent: false }, response => {
    response.resume();
    response.on("end", () => {
      console.log("get", response.statusCode, response.httpVersion, typeof response.headers.date);
      server.close();
    });
  });
});
