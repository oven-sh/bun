// @ts-expect-error
enum Level { Low = 1 } // @ts-expect-error
enum Level { Low = 5, Mid = Low * 2 } // @ts-expect-error
enum Level { Low = 9 }
function read() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return Level.Low + work; }
console.log(Level.Low, Level.Mid, read(), Level[9], Level[5], Level[1]);
