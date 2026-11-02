// A required module calls import() of a CommonJS file and then requires the file, which throws.
require("./module.mjs");
/* Output:
file runs
module: require threw thrown by the file
module: rejected thrown by the file
*/
