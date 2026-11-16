process.argv.splice(1, 1);const { jest } = Bun.jest();
         const savedSetTimeout = setTimeout;
         jest.useFakeTimers();
         console.log(require("node:timers").setTimeout === savedSetTimeout);
         require("node:util").promisify(savedSetTimeout)(1, "real").then(console.log);
         require("node:timers/promises").setTimeout(1, "promises").then(console.log);
         console.log(jest.getTimerCount());