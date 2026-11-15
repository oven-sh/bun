// So does the name that an arrow function takes from its binding.
const constructor = () => {};
const key = constructor.name;
const pick = (holder, key) => holder[key];
