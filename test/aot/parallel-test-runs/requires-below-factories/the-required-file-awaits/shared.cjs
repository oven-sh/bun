let rate; try { rate = require("./rate").rate; } catch (e) { rate = e.constructor.name; } console.log("SAID shared runs", rate); exports.shared = () => rate;
