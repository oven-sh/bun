// the order of the keys: the definitions come first, in the order of the class, whatever the order of the stores
class A { b; a; constructor(seed) { this.a = seed; this.c = 1; this.b = seed + 1; } }
class B extends A { y; x; constructor(seed) { super(seed); this.x = seed; this.y = seed; } }
console.log(Object.keys(new A(1)).join(), Object.keys(new B(1)).join(), JSON.stringify(new B(2)));
let text = ""; for (const key in new B(3)) text += key; console.log(text);
