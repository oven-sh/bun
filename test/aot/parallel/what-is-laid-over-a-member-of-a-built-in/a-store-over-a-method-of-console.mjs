const log = console.log;
console.log = function (...said) { log("SAID", typeof this.Console, ...said); };
console.log("a");
