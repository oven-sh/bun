const restH = time => new Promise(done => setTimeout(done, time));
export const requireH = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
export const importH = async name => { try { const names = await Promise.race([import(name), restH(400)]); return names === undefined ? "waits" : names.seen; } catch (error) { return "rejected " + error.name; } };
