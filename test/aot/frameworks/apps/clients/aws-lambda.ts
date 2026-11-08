import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    return Response.json({ echoed: await request.json(), path: new URL(request.url).pathname });
  },
});
const client = new LambdaClient({
  region: "us-east-1",
  endpoint: `http://localhost:${server.port}`,
  credentials: { accessKeyId: "a", secretAccessKey: "b" },
  maxAttempts: 1,
});
const { Payload, StatusCode } = await client.send(
  new InvokeCommand({ FunctionName: "hello", Payload: new TextEncoder().encode(JSON.stringify({ name: "world" })) }),
);
console.log(StatusCode, Payload?.transformToString());
client.destroy();
server.stop(true);
