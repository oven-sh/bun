exports.value = 1;
import("./file.cjs").catch(() => {});
throw new RangeError("thrown by the file");
