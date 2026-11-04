const show = (m) => (m === undefined ? "undefined" : typeof m + ":" + JSON.stringify(m.exports) + ":" + typeof m.id + ":" + m.loaded);
console.log("own-file:", show(require.cache[__filename]), require.cache[__filename] === module);
