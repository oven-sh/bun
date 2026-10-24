// What a namespace that merges with a class exports is a property of the class.
class A {}
namespace A { export const y = 2; }
console.log(Object.keys(A).join());
