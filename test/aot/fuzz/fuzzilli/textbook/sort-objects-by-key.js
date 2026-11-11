const rows = JSON.parse('[{"name":"fir","age":30},{"name":"ash","age":12},{"name":"elm","age":21}]');
rows.sort((a, b) => a.age - b.age);
const youngest = rows[0];
console.log(youngest.name, rows.map(row => row.name).join());
