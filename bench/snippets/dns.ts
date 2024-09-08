import { dns } from "bun";
import { bench, group, run } from "./runner.mjs";

async function forEachBackend(name, fn) {
  group(name, () => {
    for (let backend of ["libc", "c-ares", process.platform === "darwin" ? "system" : ""].filter(Boolean))
      bench(backend, fn(backend));
  });
}

forEachBackend("dns.lookup remote x 50", backend => async () => {
  const run = () => dns.lookup(Math.random().toString(16) + ".example.com", { backend }).catch(() => {});
  var remain = 16;
  var done;
  await new Promise(resolve => {
    for (var i = 0; i < 16; i++)
      run().finally(() => {
        remain--;
        if (remain === 0) {
          done();
        }
      });
    done = resolve;
  });
});

forEachBackend("(cached) dns.lookup remote x 50", backend => {
  var tld = "example.com";
  const run = () => dns.lookup(tld, { backend }).catch(() => {});

  return async () => {
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
  };
});

forEachBackend("(cached in batch) dns.lookup remote x 50", backend => async () => {
  var tld = Math.random().toString(16) + ".example.com";
  const run = () => dns.lookup(tld, { backend }).catch(() => {});
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

await run();
