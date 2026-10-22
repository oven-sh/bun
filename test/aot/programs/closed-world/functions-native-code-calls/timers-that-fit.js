// Timers whose delays fit warn about nothing, and the program has neither the function that prints a warning nor the tick queue.
// STATISTIC: ImageFunctionsEmitted <= 16
setTimeout(() => console.log("second"), 5);
setTimeout(() => console.log("first"), 0);
const interval = setInterval(() => {
  console.log("third");
  clearInterval(interval);
}, 10);
