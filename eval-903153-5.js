process.argv.splice(1, 1);const { jest } = Bun.jest();
           jest.useFakeTimers();
           let ticks = 0;
           function tick() { ticks++; jest.useRealTimers(); }
           setTimeout(tick, 1).refresh();
           jest.advanceTimersByTime(5);
           process.on("exit", () => console.log(ticks));