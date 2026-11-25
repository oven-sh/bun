// STATISTIC: ImageFunctionsEmitted <= 20
const shelf = Object.defineProperties({ count: 0 }, JSON.parse('{"a":{"value":1,"enumerable":true}}'));
console.log(shelf, Reflect.defineProperty(shelf, JSON.parse('"b"'), { value: "two", enumerable: true }), shelf.b);
