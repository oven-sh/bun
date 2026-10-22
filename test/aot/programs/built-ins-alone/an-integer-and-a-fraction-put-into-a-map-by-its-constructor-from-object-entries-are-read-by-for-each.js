const held = new Map(Object.entries({ a: 7, b: 1.5 }));
held.forEach((value, key) => console.log(key, value + 1));
