// @ts-expect-error
enum Level { Low = 1, High = 2 } // @ts-expect-error
enum Level { Low = 5 }
console.log(Level.Low, Level["Low"]); // @ts-expect-error
console.log(Level.Low === 5 ? "last" : "first");
switch (JSON.parse("5")) {
  case Level.Low: console.log("case Low"); break;
  default: console.log("default");
}
