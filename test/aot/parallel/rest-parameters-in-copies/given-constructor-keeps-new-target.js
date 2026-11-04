class Base { constructor() { this.made = new.target.name; this.isOwn = new.target === Base; } }
class Given extends Base {}
class Below extends Given {}
function Plain() {}
Plain.prototype = Object.create(null);
for (let i = 0; i < 3; i++) {
  const odd = Reflect.construct(Given, [i], Plain);
  console.log(new Base().made, new Given().made, new Below().made, new Below().isOwn, new Given() instanceof Given, new Below() instanceof Given, odd.made, Object.getPrototypeOf(odd) === Plain.prototype, Object.getPrototypeOf(new Below()) === Below.prototype);
}
