process.argv.splice(1, 1);const { vi } = Bun.jest();
         process.on("uncaughtException", error => console.log("uncaught:", error.message));
         vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
         setTimeout(() => { throw new Error("from a timer"); }, 1);
         setTimeout(() => (console.log("later"), vi.useRealTimers()), 3);