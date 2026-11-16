process.argv.splice(1, 1);const { vi } = Bun.jest();
         process.on("uncaughtException", error => console.log("uncaught:", error.message));
         vi.useFakeTimers();
         vi.setTimerTickMode("nextTimerAsync");
         setTimeout(() => { throw new Error("from a timer"); }, 1);
         setTimeout(() => console.log("later"), 3);