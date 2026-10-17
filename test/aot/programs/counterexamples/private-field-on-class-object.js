// A private field of another class installed on a class object leaves the class as it was.
class C {}
new class extends class { constructor(o) { return o; } } { #p; }(C);
console.log(C.name);
