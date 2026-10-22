const subject = { first: 1, second: 2 };
subject.__proto__ = "text";
console.log(typeof subject.__proto__, Object.keys(subject.__proto__).join());
