// A delay that is written and fits a timer never makes it warn, so neither the printer of warnings nor the queue of ticks is in the executable.
// STATISTIC: ImageFunctionsEmitted <= 8
setTimeout(() => console.log("rang"), 1);
