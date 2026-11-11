// The pattern reads a name off the namespace object itself: the file goes out of sight, and the program says what it said.
import * as fs from "node:fs";
const { existsSync } = fs;
console.log(existsSync("/"));
