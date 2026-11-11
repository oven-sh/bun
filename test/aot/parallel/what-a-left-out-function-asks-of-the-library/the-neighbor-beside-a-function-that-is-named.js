// The constant is named, so the function that it holds is made, and what it reads under a key counts.
// STATISTIC: FunctionsLowered >= 300
const pickLater = function (from, key) { return from[key]; }, doubled = [1, 2, 3].map((n) => n * 2).join("");
console.log(`SAID ${doubled} ${typeof pickLater}`);
