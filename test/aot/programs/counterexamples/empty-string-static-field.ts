// `static "" = 1` is read as `B[""]`.
class B { static "" = 1; }
console.log(B[""]);
