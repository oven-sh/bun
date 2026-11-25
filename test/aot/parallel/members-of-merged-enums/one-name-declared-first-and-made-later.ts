// @ts-expect-error
declare enum Level { Low = 1 } // @ts-expect-error
enum Level { Low = 5 } // @ts-expect-error
console.log(Level.Low, Level.Low === 5 ? "made" : "declared");
