const nothing = JSON.stringify(undefined);
console.log(nothing === undefined, typeof nothing, JSON.stringify(() => {}) === undefined, JSON.stringify(Symbol.iterator) === undefined, JSON.stringify(null).length);
