// STATISTIC: FunctionNamesReadFromMirrors >= 6
const bare = () => Object.create(null);
let sum = 0;

function put0(o, v) { o.x0 = v; }
function count0(o) { o.n0 = 1; }
const frozen0 = Object.freeze({ x0: 1 }), bare0 = Object.create(null), plain = function () {};
const one0 = o => { put0(o, 1); sum += o.x0; count0(o); };
put0(frozen0, 0); one0(bare0); one0(plain);
console.log(plain.x0, plain.n0, Object.keys(plain).join(), bare0.x0, frozen0.x0);

function put1(o, v) { o.y1 = v; }
function count1(o) { o.n1 = 1; }
const frozen1 = Object.freeze({ y1: 1 }), bare1 = Object.create(null), arrow = () => 1;
const one1 = o => { put1(o, 2); sum += o.y1; count1(o); };
put1(frozen1, 0); one1(bare1); one1(arrow);
console.log(arrow.y1, arrow.n1, Object.keys(arrow).join(), bare1.y1, frozen1.y1);

function put2(o, v) { o.z2 = v; }
function count2(o) { o.n2 = 1; }
const frozen2 = Object.freeze({ z2: 1 }), bare2 = Object.create(null), asynchronous = async () => {};
const one2 = o => { put2(o, 3); sum += o.z2; count2(o); };
put2(frozen2, 0); one2(bare2); one2(asynchronous);
console.log(asynchronous.z2, asynchronous.n2, Object.keys(asynchronous).join(), bare2.z2, frozen2.z2);

function put3(o, v) { o.a3 = v; }
function count3(o) { o.n3 = 1; }
const frozen3 = Object.freeze({ a3: 1 }), bare3 = Object.create(null), generator = function* () {};
const one3 = o => { put3(o, 4); sum += o.a3; count3(o); };
put3(frozen3, 0); one3(bare3); one3(generator);
console.log(generator.a3, generator.n3, Object.keys(generator).join(), bare3.a3, frozen3.a3);

function put4(o, v) { o.b4 = v; }
function count4(o) { o.n4 = 1; }
const frozen4 = Object.freeze({ b4: 1 }), bare4 = Object.create(null), named = function inner() { return 2; };
const one4 = o => { put4(o, 5); sum += o.b4; count4(o); };
put4(frozen4, 0); one4(bare4); one4(named);
console.log(named.b4, named.n4, Object.keys(named).join(), bare4.b4, frozen4.b4);

function put5(o, v) { o.q5 = v; }
function count5(o) { o.n5 = 1; }
const frozen5 = Object.freeze({ q5: 1 }), bare5 = Object.create(null), built = class { static y = 1; };
const one5 = o => { put5(o, 6); sum += o.q5; count5(o); };
put5(frozen5, 0); one5(bare5); one5(built);
console.log(built.q5, built.n5, Object.keys(built).join(), bare5.q5, frozen5.q5);

function put6(o, v) { o.d6 = v; }
function count6(o) { o.n6 = 1; }
const frozen6 = Object.freeze({ d6: 1 }), bare6 = Object.create(null), method = ({ method() {} }).method;
const one6 = o => { put6(o, 7); sum += o.d6; count6(o); };
put6(frozen6, 0); one6(bare6); one6(method);
console.log(method.d6, method.n6, Object.keys(method).join(), bare6.d6, frozen6.d6);

function put7(o, v) { o.e7 = v; }
function count7(o) { o.n7 = 1; }
const frozen7 = Object.freeze({ e7: 1 }), bare7 = Object.create(null), bound = Math.max.bind(null);
const one7 = o => { put7(o, 8); sum += o.e7; count7(o); };
put7(frozen7, 0); one7(bare7); one7(bound);
console.log(bound.e7, bound.n7, Object.keys(bound).join(), bare7.e7, frozen7.e7);

console.log(sum);
