let api = null;
function poll(n) { let s = 0; for (let i = 0; i < n; i++) { if (api) s += api.get(); } return s; }
function always(n) { let s = 0; for (let i = 0; i < n; i++) s += api.get(); return s; }
console.log(poll(3), always(0));
(function () { let hidden = { x: 5 }; const fixed = { y: 1 }; api = { get: function () { return hidden.x + fixed.y; }, set: function (v) { hidden = { x: v }; } }; })();
console.log(poll(3), always(2)); api.set(7); console.log(poll(3), always(2));
