exports.value = 1;
import("./file.cjs").then(
  () => console.log("file: imported"),
  error => console.log("file: rejected", error.message),
);
throw new RangeError("thrown by the file");
