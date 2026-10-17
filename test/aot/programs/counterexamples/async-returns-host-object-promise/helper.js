class Stats { constructor() { this.size = 1 } isDirectory() { return true } }
globalThis.stat = async function (p) { return new Stats() };
