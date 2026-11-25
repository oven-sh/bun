module.exports = { [Symbol.hasInstance](value) { return typeof value.mainModule.require(this.wanted).gzipSync === "function"; } };
