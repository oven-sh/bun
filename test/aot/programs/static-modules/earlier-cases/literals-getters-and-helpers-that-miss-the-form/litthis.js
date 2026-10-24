module.exports = { name: "litthis", who() { return this.name; }, f: function () { return this === module.exports; } };
