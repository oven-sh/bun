function text(d) { return d.toString(); }
exports.text = text;
exports.first = () => text(Buffer.from([65, 66]));
