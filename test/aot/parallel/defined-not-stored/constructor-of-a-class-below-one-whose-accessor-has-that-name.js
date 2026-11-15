class OnlySetter { set ["constructor"](value) {} }
class Below extends OnlySetter {}
console.log(new Below().constructor === Below, new OnlySetter().constructor);
