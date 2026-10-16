// `[] instanceof bound` goes by the `prototype` that the target got after the bind.
const f = () => 1, b = f.bind(null);
f.prototype = Array.prototype;
console.log([] instanceof b);
