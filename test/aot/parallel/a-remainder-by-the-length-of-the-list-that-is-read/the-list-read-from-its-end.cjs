var kit = Object.freeze({ __proto__: null, place: function place(out, a, m) { var x = a[0], y = a[1], z = a[2], w = m[3] * x + m[7] * y + m[11] * z + m[15]; w = w || 1.0; out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w; out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w; out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w; return out; } });
var corners = JSON.parse("[[1,2,3],[4,5,6],[7,8,9],[2,4,8],[3,9,27]]"), frame = new Float32Array(16), out = new Float32Array(3);
frame[0] = frame[5] = frame[10] = frame[15] = 1; frame[12] = 2;
const place = kit.place;
function fromTheEnd(corners) { var s = 0; for (var i = 0; i < corners.length; i++) { place(out, corners[corners.length - 1 - i], frame); s += out[0]; } return s; }
const n = 5; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + fromTheEnd(corners)) % 1000003; console.log(Math.floor(sum));
