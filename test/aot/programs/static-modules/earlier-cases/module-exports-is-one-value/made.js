function make() { return { made: true, who() { return this.made; } }; }
module.exports = make();
