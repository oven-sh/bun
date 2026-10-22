const held = new Set();
held.add(1.5);
held.add(undefined);
held.forEach(value => console.log(typeof value, value));
