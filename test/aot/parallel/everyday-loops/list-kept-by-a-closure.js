// A list that a closure pushes onto while loops do, too
function record(times) {
  const log = [];
  const note = text => log.push(text);
  for (let i = 0; i < 3; i++) {
    log.push(i);
    for (let k = 0; k < 2; k++) {
      log.push(k + 0.5);
      if (k < times) note("n" + i + k);
    }
    log.push(log.length);
  }
  return log.join(" ");
}
console.log(record(0));
console.log(record(1));
console.log(record(2));
