Object.defineProperty(exports, "first", { enumerable: true, get() { console.log("throws: first getter runs"); throw new Error("thrown by a getter"); } });
Object.defineProperty(exports, "second", { enumerable: true, get() { console.log("throws: second getter runs"); return 2; } });
console.log("throws ends");
