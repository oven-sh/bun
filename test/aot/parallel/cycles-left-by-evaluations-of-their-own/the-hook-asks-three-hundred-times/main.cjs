let calls = 0;
globalThis.hook = () => { let sum = 0; for (let turn = 0; turn < 300; turn++) { sum += require("./outside.mjs").seen; calls++; } return sum; };
try { console.log("first:", String(require("./first.mjs").ok)); } catch (error) { console.log("first:", error.message); }

let good = 0;
for (let turn = 0; turn < 300; turn++) {
  try { if (require("./second.mjs").ok === true) good++; } catch (error) { }
}
console.log("second:", good, calls);
