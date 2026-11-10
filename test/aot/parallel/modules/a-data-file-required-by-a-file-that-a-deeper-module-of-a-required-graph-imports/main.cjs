// The guard of the program beside this one: the CommonJS file is imported two levels down, the data file by the required module itself: the loader has come to the data file first, and the require
// gets the namespace.
require("./app.mjs");
