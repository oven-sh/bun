import { lookup, resolve } from "node:dns/promises";
import { bench, run } from "../runner.mjs";

bench("(cached) dns.lookup remote x 50", async () => {
  var tld = "example.com";
  const run = () => lookup(tld).catch(() => {});
  const total = 50;
  var remain = total;
  var done;
  await new Promise(resolve => {
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
  var tld = Math.random().toString(16) + ".example.com";
  const run = () => lookup(tld).catch(() => {});
  const total = 50;
  var remain = total;
  var done;
  await new Promise(resolve => {
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
  var remain = 50;
  var done;
  const run = () => lookup(Math.random().toString() + ".example.com").catch(() => {});

  await new Promise(resolve => {
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

bench("dns.resolve remote x 50", async () => {
  var remain = 50;
  var done;
  const run = () => resolve(Math.random().toString() + ".example.com").catch(() => {});

  await new Promise(resolve => {
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
