await new Promise(done => process.nextTick(done));
for (const step of [1, 2, 3]) console.log("awaits-tick", await step);
