const subject = {};
subject.__proto__ = 1.5;
console.log(typeof subject.__proto__, Object.keys(subject.__proto__).join());
