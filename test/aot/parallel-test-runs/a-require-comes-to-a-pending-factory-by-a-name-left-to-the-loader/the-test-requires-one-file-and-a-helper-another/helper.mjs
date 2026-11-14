export const byHelper = name => { try { return require(name).shade; } catch (error) { return "threw " + error.name; } };
