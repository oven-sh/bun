const result = new Intl.PluralRules("an", 2.5);
console.log(typeof result, Object.keys(result).join());
