function index(list) { return new Map(list.entries()); }
console.log(index(JSON.parse("[\"a\",\"b\"]")).size);
