// So does a key of constant data.
const key = Object.keys({ constructor: 1 })[0];
const pick = (holder, key) => holder[key];
