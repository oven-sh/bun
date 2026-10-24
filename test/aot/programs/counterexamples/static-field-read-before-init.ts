// A static field that a static method reads ahead of its initializer is undefined.
class S { static a = S.f(); static b: number | undefined = 1; static f() { return S.b; } }
console.log(S.a, S.b);
