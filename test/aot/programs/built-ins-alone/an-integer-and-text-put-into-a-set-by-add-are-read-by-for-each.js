const held = new Set();
held.add(7);
held.add("text");
held.forEach(value => console.log(typeof value, value));
