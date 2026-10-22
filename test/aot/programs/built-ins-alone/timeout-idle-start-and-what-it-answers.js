const subject = setTimeout(() => {}, 0);
const result = subject._idleStart;
console.log(typeof result);
