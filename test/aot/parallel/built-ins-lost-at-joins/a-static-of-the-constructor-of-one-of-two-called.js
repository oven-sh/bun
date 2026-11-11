const above = JSON.parse("true") ? Map.prototype : JSON.parse("{}");
console.log(above.constructor.groupBy([1, 2, 3], each => each % 2).size);
