function paint(x) { return x + 1; }
exports.paint = paint;
exports.twice = () => paint(1) + paint(2);
