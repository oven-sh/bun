// The static block of a class expression assigns a variable of the function around it, and a field initializer of the class reads and counts up the same variable.
const withId = Base => { let next = 1; return class extends Base { static { next = 100; } id = next++; }; };
class S extends withId(Object) {}
console.log(new S().id, new S().id);
