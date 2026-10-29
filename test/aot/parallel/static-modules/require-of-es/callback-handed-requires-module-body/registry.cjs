exports.listeners = [];
exports.emit = () => exports.listeners.forEach(listener => listener());
