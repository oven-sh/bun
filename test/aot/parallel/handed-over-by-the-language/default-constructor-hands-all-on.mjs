const seen = [];
class A { constructor(first, second) { seen.push("first:" + typeof first + (first === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); } }
class B extends A {}
new A(7, 8);
new B("text"); new B();
console.log(seen.join(" "));
