const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
console.log(held.indexOf(1.5), held.includes(7), held.lastIndexOf(7), held.includes(99));
