console.log("body: a CommonJS file behind");
Promise.resolve().then(() => console.log("job: a CommonJS file behind"));
exports.b = 2;
