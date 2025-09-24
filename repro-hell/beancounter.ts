let count = 0;
process.stdin.on("data", chunk => {
  count += chunk.length;
});
process.stdin.on("end", () => {
  console.log(count);
});
