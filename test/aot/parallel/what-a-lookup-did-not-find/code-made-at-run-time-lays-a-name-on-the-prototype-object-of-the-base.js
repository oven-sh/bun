class Base {}
class Heir extends Base {
    own = 1;
}
const lay = new Function("holder", "holder.extra = 5;");
function ask(heir) {
    return heir.extra;
}
console.log(ask(new Heir()));
lay(Base.prototype);
console.log(ask(new Heir()));
