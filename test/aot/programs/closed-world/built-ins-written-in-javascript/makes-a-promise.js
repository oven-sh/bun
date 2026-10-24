// The Promise constructor is a function of Bun's library: it hands the executor two functions of its own, and they resolve the promise with a value that the compiler does not follow there. Resolving looks for `then` on that value, and that is no sign of code that nobody compiles.
// STATISTIC: ImageFunctionsEmitted <= 100
new Promise(resolve => resolve(1)).then(value => console.log(value));
