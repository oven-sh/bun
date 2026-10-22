const most = Reflect.apply(Math.max, null, [1, 2.5, 2]);
console.log(typeof most, most + 1);
