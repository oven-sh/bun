process.argv.splice(1, 1);const { jest: api } = Bun.jest();
         api.useFakeTimers();
         setTimeout(() => console.log("fired"), 1000).unref();
         api.runAllTimersAsync().then(() => (api.useRealTimers(), console.log("settled")));