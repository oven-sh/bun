const one = require('./one.mjs');
exports.look = () => String(one.sep) + one['sep'] + one?.sep + one.join('a', 'b') + require('./one.mjs').sep;
