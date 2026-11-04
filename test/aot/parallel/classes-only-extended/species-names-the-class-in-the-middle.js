class First extends Array { static get [Symbol.species]() { return First; } who() { return "first"; } }
class Second extends First { who() { return "second"; } }
const second = new Second(1, 2, 3);
const mapped = second.map(x => x * 2);
console.log(second.who(), mapped.who(), mapped.length, mapped.join(), mapped instanceof Second, mapped instanceof First, mapped.constructor.name);
