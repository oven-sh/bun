const first = exports, second = module.exports = { second: true };
first.lost = true;
second.sameAsFirst = first === second;
