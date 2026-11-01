import { DynamoDBClient, GetItemCommand, PutItemCommand, ResourceNotFoundException } from "@aws-sdk/client-dynamodb";

const items = new Map<string, unknown>();
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const target = request.headers.get("x-amz-target")!.split(".")[1];
    const body = (await request.json()) as {
      TableName: string;
      Item?: { id: { S: string } };
      Key?: { id: { S: string } };
    };
    const headers = { "content-type": "application/x-amz-json-1.0" };
    if (body.TableName !== "users")
      return new Response(
        JSON.stringify({
          __type: "com.amazonaws.dynamodb.v20120810#ResourceNotFoundException",
          message: "Requested resource not found",
        }),
        { status: 400, headers },
      );
    if (target === "PutItem") return (items.set(body.Item!.id.S, body.Item), new Response("{}", { headers }));
    return new Response(JSON.stringify({ Item: items.get(body.Key!.id.S) }), { headers });
  },
});
const client = new DynamoDBClient({
  region: "us-east-1",
  endpoint: `http://localhost:${server.port}`,
  credentials: { accessKeyId: "a", secretAccessKey: "b" },
  maxAttempts: 1,
});
await client.send(
  new PutItemCommand({ TableName: "users", Item: { id: { S: "1" }, age: { N: "30" }, tags: { SS: ["a", "b"] } } }),
);
const { Item } = await client.send(new GetItemCommand({ TableName: "users", Key: { id: { S: "1" } } }));
console.log(Item?.id.S, Item?.age.N, Item?.tags.SS?.join());
try {
  await client.send(new GetItemCommand({ TableName: "nothing", Key: { id: { S: "1" } } }));
} catch (error) {
  console.log(error instanceof ResourceNotFoundException, (error as Error).name, (error as Error).message);
}
client.destroy();
server.stop(true);
