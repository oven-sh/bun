process.on("uncaughtException", e => {
  console.error(e);
});

await Bun.sleep(1000);

throw new Error("Lol");
