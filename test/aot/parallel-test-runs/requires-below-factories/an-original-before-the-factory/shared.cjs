const { rate } = require("./rate"); console.log("shared runs", rate); exports.shared = () => rate;
