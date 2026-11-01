// A class below Set comes out of an arrow function, is linked above the prototype of a function, and is constructed with a class below that function as new.target.
function Emitter() {}
class Interface extends Emitter {}
const make = () => class extends Set {};
const Base = make();
Object.setPrototypeOf(Emitter.prototype, Base.prototype);
try {
  console.log(String(Reflect.construct(Base, [], Interface)));
} catch (error) {
  console.log("threw", error.name);
}
