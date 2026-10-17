// The stack frame of a function that was called with `new` says `new`.
function Made() { this.s = new Error().stack; }
console.log(new Made().s.split("\n")[1].trim().split(" (")[0]);
