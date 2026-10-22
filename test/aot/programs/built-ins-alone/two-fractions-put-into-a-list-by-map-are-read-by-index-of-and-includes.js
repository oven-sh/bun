const held = [0, 1].map(index => (index === 0 ? 1.5 : 2.5));
console.log(held.indexOf(2.5), held.includes(1.5), held.lastIndexOf(1.5), held.includes(99));
