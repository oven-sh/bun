// @ts-expect-error
enum Level { Low = 1 } // @ts-expect-error
declare enum Level { Low = 5 }
console.log(Level.Low, Level.Low === 1 ? "made" : "declared");
