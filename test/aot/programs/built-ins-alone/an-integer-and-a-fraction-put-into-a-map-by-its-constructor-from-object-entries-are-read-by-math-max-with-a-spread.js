const held = new Map(Object.entries({ a: 7, b: 1.5 }));
console.log(Math.max(...held.values()) + 1);
