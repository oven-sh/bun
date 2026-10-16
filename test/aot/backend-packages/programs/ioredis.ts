import Redis from "ioredis";
import { fakeRedis } from "./fake_redis.ts";
import { listen } from "./lib_http.ts";

const seen: string[] = [];
const server = fakeRedis(seen);
const port = await listen(server);
const redis = new Redis({ host: "127.0.0.1", port, lazyConnect: true, maxRetriesPerRequest: 1 });
await redis.connect();
console.log(await redis.set("a", "1"), await redis.get("a"), await redis.incr("a"), await redis.get("missing"));
console.log(await redis.hset("h", { x: "1", y: "2" }), JSON.stringify(await redis.hgetall("h")));
console.log(JSON.stringify(await redis.pipeline().set("b", "2").get("b").exec()));
console.log(JSON.stringify(await redis.multi().incr("a").incr("a").exec()));
await redis.quit();
server.close();
console.log(seen.join(" | "));
console.log("DONE");
