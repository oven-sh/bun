"use strict";
module.exports = function nameOf(func) {
  const cache = require.cache;
  if (cache) {
    const keys = Object.keys(cache);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (cache[key].exports === func) return "file " + key.split("/").pop();
    }
  }
  return func.name || null;
};
