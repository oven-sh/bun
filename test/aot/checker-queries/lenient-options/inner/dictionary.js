// An object literal of a JavaScript file takes every name.
const table = {};
export function set(key, value) { table[String(key)] = value; }
export function get(key) { return table[String(key)]; }
export function take(key) { return table[key]; }
