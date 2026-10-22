const subject = setTimeout(() => {}, 0);
subject._idleStart = "an";
console.log(typeof subject._idleStart);
