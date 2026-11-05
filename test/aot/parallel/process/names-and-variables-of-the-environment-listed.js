// The names of the environment are listed and its variables are copied. Nothing else of the library is compiled for that.
// STATISTIC: ImageFunctionsEmitted <= 20 Todo on win32: the object is a proxy there, which windowsEnv() of the library makes: 397 functions. A program that only copies it stays within the bound there: child-handed-the-environment-and-one-more-variable.js
console.log(Object.keys(process.env).length > 0, typeof { ...process.env }.PATH !== "object");
