class Twice { member() { return "first"; } get member() { return "the getter"; } static fixed = 1; static fixed() { return "the method"; } }
console.log(new Twice().member, Twice.fixed);
class Other { get member() { return "the getter"; } member() { return "the method"; } }
console.log(new Other().member());
