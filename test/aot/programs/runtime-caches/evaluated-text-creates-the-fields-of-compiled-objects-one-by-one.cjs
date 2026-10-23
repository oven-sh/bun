function empty(fills, v) { var o = {}; if (fills) { o.a = v; o.b = v; o.c = v; o.d = v; o.e = v; o.f = v; o.length = v; } return o; }
console.log(Object.keys(empty(true, 1)).join(), Object.keys(empty(true, "x")).join(), Object.keys(empty(true, {})).join());
console.log(eval("function fill() { var o = empty(false); o.a = 1; o.b = 2; o.c = 3; o.d = 4; o.e = 5; o.f = 6; o.length = 7; return o; } var all = []; for (var i = 0; i < 9; i++) all.push(fill()); all.map(function (o) { return Object.keys(o).join() + ':' + o.length; }).join(' ')"));
