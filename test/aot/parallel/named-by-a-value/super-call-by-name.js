class Base { hello() { return "hello"; } get word() { return "word"; } static make() { return "made"; } }
class Derived extends Base { hi() { return super.hello() + " " + super.word; } static build() { return super.make(); } }
console.log(new Derived().hi(), Derived.build());
