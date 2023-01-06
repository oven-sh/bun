import { dns } from "bun";
import { bench, run } from "mitata";

bench("(cached) dns.lookup remote x 50", async () => {
  var tld = "example.com";
  const run = () => dns.lookup(tld).catch(() => {});
  const total = 50;
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

bench("(cached in batch) dns.lookup remote x 50", async () => {
  var tld = Math.random().toString(16) + "example.com";
  const run = () => dns.lookup(tld).catch(() => {});
  const total = 50;
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

bench("dns.lookup remote x 50", async () => {
  const run = () =>
    dns.lookup(Math.random().toString() + ".example.com").catch(() => {});
  var remain = 50;
  var done;
  await new Promise((resolve) => {
    for (var i = 0; i < 50; i++)
      run().finally(() => {
        remain--;
        if (remain === 0) {
          done();
        }
      });
    done = resolve;
  });
});

await run();
