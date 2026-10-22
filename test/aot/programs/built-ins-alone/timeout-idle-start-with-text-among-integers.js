const subject = setTimeout(() => {}, 0);
subject._idleStart = "text";
console.log(typeof subject._idleStart);
