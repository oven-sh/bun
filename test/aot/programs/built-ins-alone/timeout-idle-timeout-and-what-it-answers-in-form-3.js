const subject = setTimeout(() => {}, 0);
subject._idleTimeout = "an";
console.log(typeof subject._idleTimeout);
