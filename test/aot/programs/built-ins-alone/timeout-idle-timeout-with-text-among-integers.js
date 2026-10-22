const subject = setTimeout(() => {}, 0);
subject._idleTimeout = "text";
console.log(typeof subject._idleTimeout);
