const pick = { yes: Boolean, odd: x => x & 1 }[JSON.parse('"yes"')];
const mixed = JSON.parse('[0,1,2,"","x"]');
console.log(JSON.stringify(mixed.filter(pick)));
