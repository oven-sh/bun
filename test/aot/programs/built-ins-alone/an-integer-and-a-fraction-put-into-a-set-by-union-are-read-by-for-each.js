const held = new Set().union(new Set([7, 1.5]));
held.forEach(value => console.log(value + 1));
