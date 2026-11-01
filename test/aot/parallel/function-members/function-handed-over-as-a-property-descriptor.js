// Object.defineProperty() reads `value` and `enumerable` off whatever it is handed.
function D() {}
D.value = 5;
D.enumerable = true;
const o = Object.defineProperty({}, "x", D);
console.log(o.x, Object.keys(o).join());
