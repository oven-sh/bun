// RUN: lower
// OPTIONS: builtin-modules

// As its neighbor that reads the message: the handler compares, converts and asks for the type of what it gets.
Promise.resolve(Symbol.iterator).then(Math.abs).catch(e => console.log("" + e, e === undefined, typeof e));
