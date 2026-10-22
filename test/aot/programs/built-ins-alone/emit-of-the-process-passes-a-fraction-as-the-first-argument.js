function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
}
process.on("ready", target);
process.emit("ready", 0.5, 1, 2, 3, 4);
