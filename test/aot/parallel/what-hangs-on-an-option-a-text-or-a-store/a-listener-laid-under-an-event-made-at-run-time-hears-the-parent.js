// The child is this program again: it is handed a word, waits for one message, answers and ends. It starts nothing.
if (process.argv.length > 2) {
  process.on(["mess", "age"].join(""), message => {
    console.log("the child heard", message);
    process.send("from the child");
    process.disconnect();
  });
} else {
  const child = Bun.spawn([process.execPath, process.argv[1], "child"], {
    stdout: "inherit",
    ipc(message) {
      console.log("the parent heard", message);
    },
  });
  child.send("from the parent");
  await child.exited;
  console.log("ended", child.exitCode);
}
