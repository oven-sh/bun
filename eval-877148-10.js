process.argv.splice(1, 1);Bun.jest().vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
         setTimeout(() => console.log("fired at", performance.now()), 3);