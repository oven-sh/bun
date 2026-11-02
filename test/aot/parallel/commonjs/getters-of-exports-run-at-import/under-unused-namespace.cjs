Object.defineProperty(exports, "first", { enumerable: true, get: function () { console.log("under-unused-namespace: getter runs"); return 1; } });
console.log("under-unused-namespace ends");
