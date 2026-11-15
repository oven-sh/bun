function never() {
  const first = second, second = first;
  process.once("exit", first);
}
console.log("SAID", typeof never);
