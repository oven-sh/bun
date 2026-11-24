let color;
try { color = require("./colors.mjs").color; } catch (error) { color = error.constructor.name; }
module.exports = () => color;
