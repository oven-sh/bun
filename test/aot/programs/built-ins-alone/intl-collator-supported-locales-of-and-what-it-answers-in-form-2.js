const result = Intl.Collator.supportedLocalesOf("an", 2.5);
console.log(Array.isArray(result), result.length);
