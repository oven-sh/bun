function Boolean(value) { return !value; }
const mixed = JSON.parse('[0,1,null,"a",""]');
console.log(JSON.stringify(mixed.filter(Boolean)));
