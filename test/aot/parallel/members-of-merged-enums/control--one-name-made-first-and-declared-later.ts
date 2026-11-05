enum Level { Low = 1 }
declare enum Level { Low = 5 }
console.log(Level.Low, Level.Low === 1 ? "made" : "declared");
