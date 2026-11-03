function sum(file) { let total = 0; for (let i = 0; i < 2000; i++) total = file.add(total, file.first + file.second); return total; }
setTimeout(() => { const file = require("./file.cjs"); console.log(Object.prototype.toString.call(file), Object.keys(file).join(), sum(file), file === require("./file.cjs")); }, 1);
