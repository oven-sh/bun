import { lookup, resolve } from "node:dns/promises";
import { bench, run } from "mitata";

bench("(cached) dns.lookup remote x 10", async () => {
  var tld = "google.com";
  const run = () => lookup(tld).catch(() => {});
  const total = 10;
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

bench("(cached in batch) dns.lookup remote x 10", async () => {
  var tld = Math.random().toString(16) + ".google.com";
  const run = () => lookup(tld).catch(() => {});
  const total = 10;
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
  var remain = 10;
  var done;
  const run = () =>
    lookup(Math.random().toString() + ".google.com").catch(() => {});

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

bench("dns.resolve remote x 10", async () => {
  var remain = 10;
  var done;
  const run = () =>
    resolve(Math.random().toString() + ".google.com").catch(() => {});

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
  await lookup("localhost");
});

await run();
