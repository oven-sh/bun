await new Promise(done => process.nextTick(done));
for (let turn = 0; turn < 12; turn++) await 0;
console.log("long resumed");
