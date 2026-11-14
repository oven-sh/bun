exports.seen = () => { try { return require("wick").width(); } catch (error) { return "caught " + error.name; } };
