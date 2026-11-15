class Any { static [Symbol.hasInstance] = () => true; }
console.log({} instanceof Any, [] instanceof Any, 5 instanceof Any);
class Below extends Any { }
console.log({} instanceof Below, [] instanceof Below, new Below() instanceof Any);
