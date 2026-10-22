// The same form read by names alone: nobody lists the function's properties or compares it. A member that is stored behind the require that closes the cycle reads undefined from the other module's body, and its value later.
require("./create.cjs");
const user = require("./user.cjs");
console.log(user.early, user.late, user.typeOfTwice);
console.log(user.read());
