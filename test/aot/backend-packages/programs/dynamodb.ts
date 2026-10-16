import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import http from "node:http";
import { listen, readBody } from "./lib_http.ts";

const seen: string[] = [];
const server = http.createServer(async (request, response) => {
  const body = await readBody(request);
  seen.push(`${request.headers["x-amz-target"]} ${body}`);
  response.setHeader("Content-Type", "application/x-amz-json-1.0");
  response.end(String(request.headers["x-amz-target"]).endsWith("GetItem") ? JSON.stringify({ Item: { id: { N: "1" }, name: { S: "ada" } } }) : "{}");
});
const port = await listen(server);
const client = new DynamoDBClient({ region: "us-east-1", endpoint: `http://127.0.0.1:${port}`, credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "not-a-secret" }, maxAttempts: 1 });
console.log((await client.send(new PutItemCommand({ TableName: "t", Item: { id: { N: "1" }, name: { S: "ada" } } }))).$metadata.httpStatusCode);
console.log(JSON.stringify((await client.send(new GetItemCommand({ TableName: "t", Key: { id: { N: "1" } } }))).Item));
client.destroy();
server.close();
console.log(seen.join("\n"));
console.log("DONE");
