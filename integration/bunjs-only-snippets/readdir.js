const { readdirSync } = require("fs");

const count = parseInt(process.env.ITERATIONS || "1", 10) || 1;

for (let i = 0; i < count; i++) {
  readdirSync(".");
}

console.log(readdirSync("."));
