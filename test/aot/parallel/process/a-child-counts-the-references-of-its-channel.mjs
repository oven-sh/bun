// process.channel of a child has the methods of Node's Control. A listener of 'message' is one counted reference, and the child leaves when the count is back at zero.
// The child is this program again.
if (process.argv.length > 2) {
  const channel = process.channel;
  console.log(channel.constructor.name, typeof channel.ref, typeof channel.unref);
  process.on("message", () => {});
  channel.refCounted();
  channel.unrefCounted();
  channel.unrefCounted();
  console.log("the child holds nothing");
} else {
  const child = Bun.spawn({
    cmd: [process.execPath, process.argv[1], "child"],
    stdio: ["ignore", "inherit", "inherit"],
    ipc() {},
  });
  console.log("the child ended with", await child.exited);
}
