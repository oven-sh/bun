typeof Bun ?? module.id;
function typeOfThis() { return typeof this; }
function storeToUndeclaredName() { try { neverDeclared55 = 1; return "stored"; } catch (error) { return error.name; } }
console.log(typeOfThis(), storeToUndeclaredName());
