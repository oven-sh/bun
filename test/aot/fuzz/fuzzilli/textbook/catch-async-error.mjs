async function risky(n) {
  await null;
  if (n > 1) throw new RangeError("too large: " + n);
  return n;
}
async function tried(n) {
  try {
    return "fine " + (await risky(n));
  } catch (error) {
    return error.name + " " + error.message;
  } finally {
    log.push(n);
  }
}
const log = [];
console.log(await tried(1), "|", await tried(2), "|", log.join());
