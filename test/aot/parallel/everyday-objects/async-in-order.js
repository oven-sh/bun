// Asynchronous functions that wait for each other, with what they log in order
async function step(log, name, waits) {
  for (let i = 0; i < waits; i++) {
    log.push(name + i);
    await null;
  }
  return name.repeat(waits);
}
async function run(a, b) {
  const log = [];
  const both = Promise.all([step(log, "a", a), step(log, "b", b)]);
  log.push("started");
  const texts = await both;
  return log.join(" ") + " = " + texts.join("+");
}
run(2, 3).then(text => (console.log(text), run(1, 1))).then(text => (console.log(text), run(0, 2))).then(console.log);
