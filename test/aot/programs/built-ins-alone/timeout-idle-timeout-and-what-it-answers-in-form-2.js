const subject = setTimeout(() => {}, 0);
subject._idleTimeout = 1.5;
console.log(typeof subject._idleTimeout);
