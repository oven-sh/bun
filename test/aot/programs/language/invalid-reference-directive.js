// An invalid triple-slash directive in JavaScript is a comment. TypeScript reports it (1084), and the build accepts it.
/// <reference foo="x" />
console.log("ran");
