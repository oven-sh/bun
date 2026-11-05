Object.defineProperty(module, "exports", { get() { return { name: "made" }; } });
console.log(module.exports.name);
