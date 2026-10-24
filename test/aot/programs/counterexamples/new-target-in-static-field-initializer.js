// `new.target` in a static field initializer is undefined, also inside a function that was called with `new`.
new function () { console.log(typeof class { static s = new.target; }.s); };
