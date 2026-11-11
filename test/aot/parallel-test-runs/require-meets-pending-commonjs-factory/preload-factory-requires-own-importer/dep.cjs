// What the factory loads requires the mocked file.
exports.seen = "dep sees " + require("./part.cjs").x;
