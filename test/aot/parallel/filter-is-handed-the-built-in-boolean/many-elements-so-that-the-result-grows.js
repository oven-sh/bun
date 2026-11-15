const many = []; const n = JSON.parse('5000'); for (let i = 0; i < n; i++) many.push(i % 3 ? 'k' + i : '');
const kept = many.filter(Boolean);
console.log(kept.length, kept[0], kept[kept.length - 1]);
