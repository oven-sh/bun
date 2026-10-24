if (typeof globalThis.neverSet === "undefined") module.exports = function first() { return "first"; };
else module.exports = function second() { return "second"; };
