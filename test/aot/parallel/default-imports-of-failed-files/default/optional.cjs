try { exports.value = require("./fails.cjs").value; } catch (e) { exports.value = e.message; }
