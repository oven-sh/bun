class WithMethod { ["constructor"]() { return "called"; } }
class Below extends WithMethod {}
console.log(new Below().constructor === Below, new WithMethod().constructor(), typeof new Below().constructor);
