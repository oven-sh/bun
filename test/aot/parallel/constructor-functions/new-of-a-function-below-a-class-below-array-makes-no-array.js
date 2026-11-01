class List extends Array {}
function Other() {}
Other.prototype = Object.create(List.prototype);

const plain = new Other();
console.log(Array.isArray(plain), plain.length, plain.push(1, 2), plain.length, JSON.stringify(plain), Object.keys(plain).join());
console.log(plain instanceof List, Object.prototype.toString.call(plain), [].concat(plain).length, [...plain].join(), plain.pop(), plain.length);

const list = Reflect.construct(List, [], Other);
console.log(Array.isArray(list), list.length, list.push(1, 2), list.length, JSON.stringify(list), Object.keys(list).join());
console.log(list instanceof List, Object.prototype.toString.call(list), [].concat(list).length, [...list].join(), list.pop(), list.length);
