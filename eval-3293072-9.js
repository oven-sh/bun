process.argv.splice(1, 1);class E extends Error { get message() { throw new RangeError("from the getter"); } }
      setTimeout(() => { setImmediate(() => console.log("immediate")); throw new E(); }, 0);
      console.log("after");