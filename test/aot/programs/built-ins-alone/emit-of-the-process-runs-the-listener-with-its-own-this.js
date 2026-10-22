function target() {
  console.log(typeof this, this === process);
}
process.on("ready", target);
process.emit("ready");
