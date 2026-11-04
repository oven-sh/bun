globalThis.hook = () => { try { return require("./north.mjs").name; } catch (error) { return error.message; } };
