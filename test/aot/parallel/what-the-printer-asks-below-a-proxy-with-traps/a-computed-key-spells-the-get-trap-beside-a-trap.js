const answered = () => "printed by the answer";
const below = Object.create(new Proxy({}, { set() { return true; }, [JSON.parse('"get"')]() { return answered; } }));
console.log(below);
