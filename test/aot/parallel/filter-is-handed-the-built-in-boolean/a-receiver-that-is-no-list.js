const like = { length: 4, 0: 1, 1: 0, 3: 'x' };
console.log(JSON.stringify(Array.prototype.filter.call(like, Boolean)), JSON.stringify(Array.prototype.filter.call('a b', Boolean)));
