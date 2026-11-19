console.log("imports-back begins");
import("./throws.cjs").then(
  file => console.log("imports-back then", Object.keys(file).join()),
  error => console.log("imports-back then throws", error.name),
);
console.log("imports-back ends");
