await new Promise(done => process.nextTick(done));
await 0;
console.log("short resumed");
