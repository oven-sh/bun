import { dns } from "bun";
import { bench, run } from "mitata";

bench("(cached parallel) dns.lookup remote x 10", async () => {
  const run = () => dns.lookup("google.com").catch(() => {});
  const total = 1000;
  var remain = total;
  var done;
  await new Promise((resolve) => {
    for (var i = 0; i < total; i++)
      run().finally(() => {
        remain--;
        if (remain === 0) {
          done();
        }
      });
    done = resolve;
  });
});

bench("dns.lookup remote x 10", async () => {
  const run = () =>
    dns.lookup(Math.random().toString() + ".google.com").catch(() => {});
  var remain = 10;
  var done;
  await new Promise((resolve) => {
    for (var i = 0; i < 10; i++)
      run().finally(() => {
        remain--;
        if (remain === 0) {
          done();
        }
      });
    done = resolve;
  });
});

bench("dns.lookup local", async () => {
  const [first, second] = await dns.lookup("localhost");
});

await run();
