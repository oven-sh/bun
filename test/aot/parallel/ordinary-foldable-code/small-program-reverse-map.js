const Level = { debug: 0, info: 1, warn: 2, error: 3 };
const NAMES = Object.fromEntries(Object.entries(Level).map(([k, v]) => [v, k]));
const threshold = Level.warn;
const shown = Object.keys(Level).filter((k) => Level[k] >= threshold);
console.log(NAMES, NAMES[2], shown);
