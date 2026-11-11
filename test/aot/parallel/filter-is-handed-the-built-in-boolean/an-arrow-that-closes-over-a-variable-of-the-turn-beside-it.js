const rows = JSON.parse('[[0,1,2,3],[3,2,1,0],[5,0,5,0]]'); let s = 0;
for (let r = 0; r < rows.length; r++) { const limit = r; s += rows[r].filter(x => x > limit).length * 10 + rows[r].filter(Boolean).length; }
console.log(s);
