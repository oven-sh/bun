const view = new Int32Array(8); view[7] = 5; function ends(v) { return [v[7], v[8], v[9], v[4294967295], v[2147483648]].join(); } console.log(ends(view));
