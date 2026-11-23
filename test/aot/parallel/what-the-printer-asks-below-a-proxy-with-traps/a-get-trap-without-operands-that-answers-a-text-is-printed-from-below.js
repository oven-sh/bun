// The host asks the object below for its method, gets a text, and prints the object like any other.
const below = Object.create(new Proxy({}, { get() { return "a"; } }));
below.own = 1;
console.log(below);
