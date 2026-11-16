process.argv.splice(1, 1);const { jest } = Bun.jest();
           jest.useFakeTimers();
           Bun.cron("* * * * *", () => {});
           jest.clearAllTimers(); jest.useRealTimers();
           console.log("exiting");