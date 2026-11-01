// A timer requires a module that calls import() on another one, so the load of that import() settles before the require() returns. Two timers later import() of that one, of the required module and of a module above both race a chain of jobs: each is fulfilled between the same jobs as under plain Bun.
setTimeout(() => {
  require("./running.mjs");
  console.log("main has required running");
  setTimeout(() => {
    setTimeout(async () => {
      const order = [];
      const jobs = (async () => {
        for (let job = 0; job < 14; job++) {
          order.push("job " + job);
          await null;
        }
      })();
      const imports = [
        import("./other.mjs").then(() => order.push("other")),
        import("./running.mjs").then(() => order.push("running")),
        import("./above.mjs").then(() => order.push("above")),
      ];
      await Promise.all([jobs, ...imports]);
      console.log(order.join(", "));
    }, 0);
  }, 0);
}, 0);
