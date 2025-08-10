const redis = new Bun.RedisClient();

async function run() {
  await redis.subscribe("my-channel-1");

  redis.on("my-channel-1", (channel, message) => {
    console.log(`Received ${message} from ${channel}`);
  });

  while (true) {
    await Bun.sleep(1000);
  }
}

run();
