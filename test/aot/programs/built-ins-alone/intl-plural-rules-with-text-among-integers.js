const result = new Intl.PluralRules(1.5, "text");
console.log(typeof result, Object.keys(result).join());
