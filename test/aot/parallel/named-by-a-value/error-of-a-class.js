class Odd extends Error { get name() { return "Odd"; } get message() { return "odd message"; } }
console.log(String(new Odd()), Error.prototype.toString.call(new Odd()));
