Promise.resolve().then(() => console.log("job of first"));
console.log("first runs");
exports.value = 1;
missing();
