declare enum Level { Low = 1 }
enum Level { Low = 5 }
console.log(Level.Low, Level.Low === 5 ? "made" : "declared");
