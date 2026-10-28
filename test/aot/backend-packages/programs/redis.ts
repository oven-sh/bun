import { createClient } from "redis";
import { fakeRedis } from "./fake_redis.ts";
import { listen } from "./lib_http.ts";

const seen: string[] = [];
const server = fakeRedis(seen);
const port = await listen(server);
const client = createClient({ socket: { host: "127.0.0.1", port, reconnectStrategy: false } });
client.on("error", (error: Error) => console.log("error", error.message));
await client.connect();
console.log(await client.set("a", "1"), await client.get("a"), await client.incr("a"), await client.get("missing"));
console.log(await client.hSet("h", { x: "1", y: "2" }), JSON.stringify(await client.hGetAll("h")));
console.log(JSON.stringify(await client.multi().incr("a").incr("a").exec()));
await client.quit();
server.close();
console.log(seen.join(" | "));
console.log("DONE");
