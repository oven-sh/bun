try { module.exports = "bridge: " + require("./panel.mjs").panel; } catch (error) { module.exports = "bridge caught " + error.constructor.name; }
