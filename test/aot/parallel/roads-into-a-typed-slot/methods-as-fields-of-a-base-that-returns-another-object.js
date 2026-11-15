// class fields with arrows, a base whose constructor is entered with another new.target, by Reflect.construct too
class Base { kind = "base"; tell = () => this.kind + ":" + this.extra; extra = 1; }
class Below extends Base { kind = "below"; tell2 = () => this.tell() + "!" + this.more; more = 2; }
class Lowest extends Below { tell = () => "lowest" + this.more; }
function Plain() {}
Plain.prototype = Object.create(Base.prototype);
const made = [new Base(), new Below(), new Lowest(), Reflect.construct(Base, [], Below), Reflect.construct(Below, [], Base), Reflect.construct(Base, [], Plain)];
console.log(made.map(o => [o.tell(), o.tell2 ? o.tell2() : "-", Object.getPrototypeOf(o) === Below.prototype, Object.keys(o).join("")].join("/")).join(" "));
