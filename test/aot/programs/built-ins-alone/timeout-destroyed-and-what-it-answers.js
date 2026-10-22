const subject = setTimeout(() => {}, 0);
const result = subject._destroyed;
console.log(typeof result);
