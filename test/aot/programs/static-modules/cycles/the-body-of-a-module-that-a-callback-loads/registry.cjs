const callbacks = [];
exports.add = callback => callbacks.push(callback);
exports.run = () => callbacks.map(callback => callback());
