class Base {}
class Heir extends Base {
    own = 1;
}
function ask(heir) {
    return heir.extra;
}
console.log(ask(new Heir()));
Base.prototype.extra = 5;
console.log(ask(new Heir()));
