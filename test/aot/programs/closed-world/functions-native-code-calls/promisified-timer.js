// util.promisify reads the promise form of a timer through a parameter, so no statement names the timer and the key together.
const { promisify } = require("node:util");
const sleep = promisify(setTimeout);
const soon = promisify(setImmediate);
sleep(1, "slept").then(async value => {
  console.log(value + " " + (await soon("soon")) + " " + (sleep === require("node:timers/promises").setTimeout));
});
