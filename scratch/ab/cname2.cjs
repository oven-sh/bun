function a() { const E = class {}; return E.name; }
function b() { const H = function () {}; return H.name; }
function c() { const I = () => {}; return I.name; }
function d() { const J = class {}; return new J().constructor.name; }
function e() { let K = class {}; return K.name; }
function f() { const L = class { static x = 1 }; return L.name; }
console.log(JSON.stringify([a(), b(), c(), d(), e(), f()]));
