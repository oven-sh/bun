process.argv.splice(1, 1);const { jest } = Bun.jest();
         jest.useFakeTimers();
         delete Date.prototype.constructor;
         jest.useRealTimers();
         console.log("done");