export const byOther = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
