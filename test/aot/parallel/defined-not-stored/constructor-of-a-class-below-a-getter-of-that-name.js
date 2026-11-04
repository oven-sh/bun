class OnlyGetter { get ["constructor"]() { return "from the getter"; } }
class Below extends OnlyGetter {}
class Lowest extends Below {}
console.log(new Below().constructor === Below, new Lowest().constructor === Lowest, new OnlyGetter().constructor);
