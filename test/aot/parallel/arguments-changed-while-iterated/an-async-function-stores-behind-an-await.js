async function waits() {
  const seen = [];
  for (const value of arguments) {
    await null;
    arguments[2] = "Z";
    seen.push(value);
  }
  return seen.join();
}
async function onlyWaits() {
  const seen = [];
  for (const value of arguments) {
    await null;
    seen.push(value);
  }
  return seen.join();
}
console.log(await waits("a", "b", "c"), await onlyWaits("a", "b", "c"));
