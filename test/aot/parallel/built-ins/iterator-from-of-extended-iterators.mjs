// Iterator.from() where the program stores on Iterator, beside classes whose static methods have the same name.
class Floats extends Float32Array {}
console.log(new Floats(2).length);
Iterator[1] = 5;
console.log(Iterator[1], String(Iterator.from([1, 2, 3]).toArray()));
