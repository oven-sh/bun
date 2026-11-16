process.argv.splice(1, 1);const { jest } = Bun.jest();
         jest.useFakeTimers({ toFake: ["setImmediate"] });
         setImmediate(() => console.log("fired"));
         jest.useRealTimers();
         console.log("exiting");