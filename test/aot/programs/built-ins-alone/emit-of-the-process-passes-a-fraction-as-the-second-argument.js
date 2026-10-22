function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
}
process.on("ready", target);
process.emit("ready", 0, 1.5, 2, 3, 4);
