var names = JSON.parse(process.argv[2] || '["a","b"]'), n = 0;
var key = {};
key[Symbol.toPrimitive] = function () { return names[n++]; };
function copy(to, from, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], found = Reflect.getOwnPropertyDescriptor(from, k);
    if (found) Reflect.defineProperty(to, k, found);
  }
  return to;
}
var target = copy({ b: 1.5 }, { a: "text", b: 2.5 }, [key]);
function read() { return target.b + 1; }
console.log(read());
