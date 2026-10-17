// A property deleted from a function used as a prototype is gone for the objects below it.
const T = [() => 1, x => x.bar], o = Object.create(T[0]);
T[0].bar = 7;
T[1](o);
delete T[0].bar;
console.log(typeof T[1](o));
