export const requireH = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
export const importH = async name => { try { return (await import(name)).seen; } catch (error) { return "rejected " + error.name; } };
