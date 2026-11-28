// The server and the client that a schema compiles to make the four kinds of call, and a call that fails.
import { GrpcError, Status } from "bun:grpc";
import * as schema from "./echo.proto";

const server = Bun.serve({
  port: 0,
  http2: true,
  routes: schema.Echo.routes({
    unary(request, context) {
      context.responseTrailers.set("x-trailer", context.headers.get("x-header") ?? "");
      if (request.text === "fail") throw new GrpcError(Status.NOT_FOUND, "100% ☃");
      return { text: "echo " + request.text };
    },
    *serverStream(request) {
      for (let number = 0; number < request.number; number++) yield { number };
    },
    async clientStream(requests) {
      let number = 0;
      for await (const request of requests) number += request.number;
      return { number };
    },
    async *bidi(requests) {
      for await (const request of requests) yield { text: "echo " + request.text };
    },
  }),
});

const client = new schema.Echo.Client(server.url, { headers: { "x-header": "h" }, timeout: 60_000 });
console.log(await client.unary({ text: "a" }, { onTrailers: trailers => console.log(trailers.toJSON()) }));
for await (const message of client.serverStream({ number: 2 })) console.log(message.number);
console.log((await client.clientStream([{ number: 1 }, { number: 2 }])).number);
for await (const message of client.bidi([{ text: "b" }, { text: "c" }])) console.log(message.text);
try {
  await client.unary({ text: "fail" });
} catch (error) {
  if (error instanceof GrpcError) console.log(error.name, error.code, error.message);
}
await server.stop(true);
