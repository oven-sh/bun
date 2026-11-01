await new Promise(done => process.nextTick(done));
for await (const each of [1, Promise.resolve(2)]) console.log("awaits-tick", each);
