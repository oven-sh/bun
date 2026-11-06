let last = Promise.resolve();
for (let turn = 0; turn < 24; turn++) last = last.then(() => console.log("behind", turn));
exports.v = 1;
