const cells = { list: [0.5, 1, 7, 2147483647, -2147483648, 0] };
cells.list.push(undefined);
function count(value) { let n = 0; for (let i = 0; i < cells.list.length + 1; i++) if (cells.list[i] === value) n++; return n; }
const asked = [1, 7, 2147483647, -2147483648, 0, 0.5, undefined, 8];
console.log("SAID " + asked.map(count).join(" "));
