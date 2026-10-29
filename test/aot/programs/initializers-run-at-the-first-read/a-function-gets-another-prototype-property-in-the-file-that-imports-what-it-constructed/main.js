// One file constructs an object at its top. The file that imports it stores to the `prototype` property of the function and reads the object afterwards: it lies below what the function had when it was made.
import { Meter, meter } from "./declared.js";
Meter.prototype = null;
console.log(Object.getPrototypeOf(meter) === Object.prototype);
