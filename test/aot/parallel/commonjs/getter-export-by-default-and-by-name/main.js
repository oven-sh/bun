// One statement imports a CommonJS file by default and one of its names, which the file defines as a getter.
import common, { double } from "./common.cjs";
console.log(double === common.double, typeof double, typeof common, double(21));
