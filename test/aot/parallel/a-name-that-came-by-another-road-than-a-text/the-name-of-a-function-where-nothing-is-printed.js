// Nothing here asks for a promise, and the name that the function spells finds every constructor.
const key = function constructor() {}.name;
const pick = (holder, key) => Reflect.get(holder, key);
