const held = new Map(Object.entries({ a: 1.5, b: 2.5 }));
held.forEach((value, key) => console.log(key, value + 1));
