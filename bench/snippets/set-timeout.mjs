import { bench, run } from "../node_modules/mitata/src/cli.mjs";

bench("setTimeout(, 4) 100 times", async () => {
  var i = 100;
  while (--i >= 0) {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve();
      }, 4);
    });
  }
});

setTimeout(() => {
  run({}).then(() => {});
}, 1);
