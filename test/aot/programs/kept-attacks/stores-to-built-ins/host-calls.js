// host-calls.js <which> <rounds>: one built-in that runs in the host, called in a loop: the price of the call all in.
const which = process.argv[2], rounds = Number(process.argv[3] ?? 1000);
const array = [1, 2, 3, 4], text = "a,b,c", object = { a: 1, b: 2, c: 3 }, map = new Map([[1, 2]]), nested = [[1], [2]];
let sum = 0;
for (let i = 0; i < rounds; i++) {
  switch (which) {
  case "none": sum += i & 1; break;
  case "lastIndexOf": sum += array.lastIndexOf(3); break;
  case "reverse": sum += array.reverse().length; break;
  case "fill": sum += array.fill(i & 3).length; break;
  case "flat": sum += nested.flat().length; break;
  case "slice": sum += array.slice(1).length; break;
  case "concat": sum += array.concat(array).length; break;
  case "indexOf": sum += array.indexOf(3); break;
  case "includes": sum += array.includes(3) ? 1 : 0; break;
  case "join": sum += array.join().length; break;
  case "sort": sum += array.sort().length; break;
  case "sortBy": sum += array.sort((a, b) => a - b).length; break;
  case "splice": sum += array.splice(1, 1, 5).length; break;
  case "from": sum += Array.from(array).length; break;
  case "fromMap": sum += Array.from(map.keys()).length; break;
  case "isArray": sum += Array.isArray(array) ? 1 : 0; break;
  case "keys": sum += Object.keys(object).length; break;
  case "entries": sum += Object.entries(object).length; break;
  case "values": sum += Object.values(object).length; break;
  case "assign": sum += Object.assign({}, object).a; break;
  case "freeze": sum += Object.freeze({ a: i }).a & 1; break;
  case "hasOwn": sum += Object.hasOwn(object, "b") ? 1 : 0; break;
  case "hasOwnProperty": sum += object.hasOwnProperty("b") ? 1 : 0; break;
  case "defineProperty": sum += Object.defineProperty({}, "x", { value: i, enumerable: true }).x & 1; break;
  case "getPrototypeOf": sum += Object.getPrototypeOf(object) === Object.prototype ? 1 : 0; break;
  case "create": sum += Object.create(null) ? 1 : 0; break;
  case "bind": sum += Math.max.bind(null, 1)(); break;
  case "apply": sum += Math.max.apply(null, array); break;
  case "stringify": sum += JSON.stringify(object).length; break;
  case "parse": sum += JSON.parse('{"a":1}').a; break;
  case "trim": sum += " a ".trim().length; break;
  case "split": sum += text.split(",").length; break;
  case "padEnd": sum += text.padEnd(8).length; break;
  case "repeat": sum += text.repeat(2).length; break;
  case "startsWith": sum += text.startsWith("a") ? 1 : 0; break;
  case "localeCompare": sum += text.localeCompare("b"); break;
  case "normalize": sum += text.normalize().length; break;
  case "codePointAt": sum += text.codePointAt(0); break;
  case "toFixed": sum += (i / 3).toFixed(2).length; break;
  case "parseInt": sum += parseInt("12", 10); break;
  case "parseFloat": sum += parseFloat("1.5"); break;
  case "symbolFor": sum += Symbol.for("x") ? 1 : 0; break;
  case "dateNow": sum += Date.now() & 1; break;
  case "newDate": sum += new Date(0).getTime(); break;
  case "newError": sum += new Error("x").message.length; break;
  case "promiseResolve": sum += Promise.resolve(1) ? 1 : 0; break;
  case "weakMap": sum += new WeakMap().has(object) ? 1 : 0; break;
  case "structuredClone": sum += structuredClone(object).a; break;
  }
}
console.log(which, rounds, sum);
