class OnlySetter { set ["constructor"](value) {} }
class Below extends OnlySetter { static make() { return "made by Below"; } }
const made = new Below();
console.log(made.constructor.make(), new made.constructor() instanceof Below);
