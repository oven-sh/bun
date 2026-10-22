const timer = setTimeout(() => {}, 1);
console.log(typeof timer, timer.hasRef(), timer.unref() === timer, timer.ref() === timer, typeof timer[Symbol.toPrimitive]());
clearTimeout(timer);
