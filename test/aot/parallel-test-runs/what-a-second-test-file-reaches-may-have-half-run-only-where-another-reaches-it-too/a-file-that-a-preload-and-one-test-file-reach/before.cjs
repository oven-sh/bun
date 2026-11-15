try { globalThis.before = Object.keys(require("./shared.cjs")).join(); } catch (error) { globalThis.before = "threw: " + error.message; }
