// What fails while fields are laid behind the call of super quotes that call, in the constructor that the engine writes for the class too.
class Base { constructor(o) { return o; } }
class A extends Base { #p = 1; }
const o = {};
new A(o);
try {
  new A(o);
} catch (error) {
  console.log(error.name, error.message);
}
