const answered = () => "printed by the answer";
const below = Object.create(new Proxy(...[{}, { get() { return answered; } }]));
console.log(below);
