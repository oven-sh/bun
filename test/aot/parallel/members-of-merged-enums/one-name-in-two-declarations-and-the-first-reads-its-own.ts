// @ts-expect-error
enum Level { Low = 1, High = Low + 1 } // @ts-expect-error
enum Level { Low = 5 }
console.log(Level.Low, Level.High, Level.High === 2 ? "by the first" : "by the last");
