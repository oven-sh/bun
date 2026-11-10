class Base {}
class Heir extends Base {
    own = 1;
}
Base.prototype.toJSON = function () {
    return "laid";
};
function ask(heir) {
    return JSON.stringify(heir);
}
console.log(ask(new Heir()));
