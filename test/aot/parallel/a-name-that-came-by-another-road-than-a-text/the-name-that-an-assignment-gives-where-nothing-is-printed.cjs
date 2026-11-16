// So does the name that a function takes from the name it is assigned to, where nothing declares that name.
constructor = function () {};
const key = constructor.name;
const pick = (holder, key) => holder[key];
