function each(list, f) { for (let i = 0; i < list.length; i++) f(list[i], i); }
const rows = []; for (let i = 0; i < 12; i++) rows.push({ id: i, name: "n" + i });
function total(list, stop) { let sum = 0; try { each(list, row => { if (row.id === stop) throw new Error("stop " + sum); sum += row.id; }); } catch (error) { return error.message + " " + sum; } return "whole " + sum; }
let out = []; for (let t = 0; t < 14; t++) out.push(total(rows, t)); console.log(out.join("|"));
