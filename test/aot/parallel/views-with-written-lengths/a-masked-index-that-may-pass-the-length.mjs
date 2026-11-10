const given = JSON.parse('{"numbers":[0,1,5,7,8,9,15,16,-1,-8,255,256,4294967295,2147483648,1.5]}');
const view = new Int32Array(8); for (let i = 0; i < 8; i++) view[i] = i * 3 + 1; function masked(v, i) { return v[i & 15]; } console.log(given.numbers.map(i => String(masked(view, i))).join());
