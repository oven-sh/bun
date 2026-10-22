class Base {}
const bound = Base.bind(null);
console.log(new Base() instanceof bound, {} instanceof bound);
