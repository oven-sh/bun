// The variable holds a text when the proxy is made and a function when the object is printed.
let answer = "a";
const below = Object.create(new Proxy({}, { get() { return answer; } }));
console.log(typeof below.first);
answer = () => "printed by the answer";
console.log(below);
