console.log("the file begins");
await new Promise(done => setTimeout(done, 30));
globalThis.waited = "behind the await";
