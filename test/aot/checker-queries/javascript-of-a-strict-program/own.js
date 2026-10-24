const table = {};
export function put(key, value) { table[String(key)] = value; }
export function own(key) { return table[String(key)]; }
export function take(key) { return table[key]; }
