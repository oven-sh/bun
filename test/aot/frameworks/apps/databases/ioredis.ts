import Redis, { Command } from "ioredis";

console.log(
  JSON.stringify(new Command("set", ["key", "value", "EX", 10]).toWritable({}).toString()),
  new Command("get", ["{user}:1"]).getSlot(),
);
const redis = new Redis({
  host: "127.0.0.1",
  port: 1,
  lazyConnect: true,
  retryStrategy: () => null,
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
});
redis.on("error", () => {});
console.log(redis.status, redis.options.port, typeof redis.get, typeof redis.pipeline().set("a", "b").exec);
try {
  await redis.connect();
} catch (error) {
  console.log((error as Error).message);
}
console.log(redis.status);
redis.disconnect();
