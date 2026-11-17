// `then`, `all`, `constructor` are read off values; what makes the first promise is a name too: fromAsync.
const made = Array.fromAsync([1, 2]);
const maker = made.constructor;
made.then(list => console.log(list.join(), maker.name));
maker.all([made]).then(all => console.log(all.length));
