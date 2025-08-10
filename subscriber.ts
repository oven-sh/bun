const redis = new Bun.RedisClient();

async function run() {
  redis.subscribe("my-channel-1");

  console.log("Subscribed to my-channel-1");

  redis.on("my-channel-1", (channel, message) => {
    console.log(`Received ${message} from ${channel}`);
  });

  while (true) {
    await Bun.sleep(1000);
  }
}

run();
