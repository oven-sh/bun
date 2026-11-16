// The handler is `{}`, written in place: nobody can lay a trap in it, so what the printer asks goes on at the target, an object of the program without the method. Nothing of the library is in the executable.
// STATISTIC: ImageFunctionsEmitted <= 30
class Plain { constructor() { this.held = 1; } }
const below = Object.create(new Proxy(Plain.prototype, {}));
below.own = 2;
console.log(below, new Proxy({ seen: 1 }, {}), new Proxy(new Plain(), {}));
