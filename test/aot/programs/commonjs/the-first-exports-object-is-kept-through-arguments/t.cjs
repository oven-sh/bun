const a = arguments;
module.exports = { name: "new", old: a[0], n: a.length, sameModule: a[2] === module };
a[0].x = 1;
