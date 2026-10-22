const subject = setTimeout(() => {}, 0);
subject._idleStart = 1.5;
console.log(typeof subject._idleStart);
