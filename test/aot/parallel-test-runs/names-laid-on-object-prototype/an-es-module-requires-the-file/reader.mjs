const shelf = require("./shelf.cjs");
export const peek = () => String(shelf.extra) + " " + shelf.a;
