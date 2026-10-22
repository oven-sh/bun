const subject = setTimeout(() => {}, 0);
const result = subject._idleTimeout;
console.log(typeof result);
