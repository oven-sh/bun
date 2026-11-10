// Two objects, one record behind them: a store on the record is not seen through the star, whose names were read when the file was loaded.
import * as star from "node:fs";
import fs from "node:fs";
console.log(star.existsSync === fs.existsSync, star.default === fs, star !== fs);
fs.existsSync = () => "mine";
console.log(star.existsSync("/"), fs.existsSync("/"));
