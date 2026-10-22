const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 1.5 : 2.5));
console.log(held.indexOf(2.5), held.includes(1.5), held.lastIndexOf(1.5), held.includes(99));
