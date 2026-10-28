console.log("file runs");
exports.value = 1;
import("./file.cjs").then(
  namespace => console.log("file: imported", Object.keys(namespace).join()),
  error => console.log("file: rejected", error.message),
);
throw new RangeError("thrown by the file");
