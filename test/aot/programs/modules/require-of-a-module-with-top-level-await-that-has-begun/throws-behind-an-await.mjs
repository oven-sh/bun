console.log("throws-behind-an-await begins");
await Promise.resolve();
throw new RangeError("behind the await");
