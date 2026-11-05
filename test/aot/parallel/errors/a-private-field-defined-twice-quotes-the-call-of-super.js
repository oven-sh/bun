// Todo: the message has no quote: plain Bun adds (evaluating 'super(...args)'), out of the constructor that it writes for the class.
class Base { constructor(o) { return o; } }
class A extends Base { #p = 1; }
const o = {};
new A(o);
try {
  new A(o);
} catch (error) {
  console.log(error.name, error.message);
}
