// Await of a thenable takes extra turns: compiled answers as plain.
const log = [];
(async () => {
  await {
    then(r) {
      log.push("then-called");
      r();
    },
  };
  log.push("a");
})();
(async () => {
  await null;
  log.push("b1");
  await null;
  log.push("b2");
  await null;
  log.push("b3");
})();
await new Promise(r => setTimeout(r, 5));
console.log(log.join());
