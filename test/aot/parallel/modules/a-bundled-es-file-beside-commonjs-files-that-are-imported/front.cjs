console.log("body: a CommonJS file in front");
Promise.resolve().then(() => console.log("job: a CommonJS file in front"));
exports.f = 1;
