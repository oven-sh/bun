module.exports = { [Symbol.hasInstance](value) { return typeof value.mainModule.require(["node:", "zlib"].join("")).gzipSync === "function"; } };
