const table = Object.fromEntries(Object.getOwnPropertyNames(Array).map(name => [name, Array[name]]));
console.log(table.from("ab").join(), table.of(1, 2).join(), table.isArray([]));
