// util.inspect lies in a file of the library that loads at the first call. Its body is copied into this loop, and what it reads of its own file is read in the turn.
import util from "node:util";
for (const value of [{}, { a: 1 }, [], [1], new Map()]) console.log(util.inspect(value));
