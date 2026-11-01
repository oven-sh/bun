const mark = () => { console.log("field runs"); return 1; };
class A { static x = mark(); who() { return "a"; } }
class B extends A { who() { return "b" + super.who(); } }
class C extends B {}
export const read = () => [A, B, C];
