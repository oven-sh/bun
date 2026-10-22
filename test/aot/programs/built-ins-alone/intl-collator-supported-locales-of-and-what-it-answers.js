const result = Intl.Collator.supportedLocalesOf(1.5, 2.5);
console.log(Array.isArray(result), result.length);
