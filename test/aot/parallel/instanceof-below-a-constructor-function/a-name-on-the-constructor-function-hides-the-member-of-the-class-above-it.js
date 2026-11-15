class Top { static make() { return "top"; } }
function Mid() {}
Object.setPrototypeOf(Mid.prototype, Top.prototype);
Object.setPrototypeOf(Mid, Top);
Mid.make = function () { return "mid of " + this.name; };
class A extends Mid {}
console.log(A.make(), Mid.make(), Top.make());
