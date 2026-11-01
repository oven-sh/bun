globalThis.order = (globalThis.order || []).concat("b")
module.exports = { value: 41, later: undefined, get computed() { return this.value * 2 } }
module.exports.later = "set later"
