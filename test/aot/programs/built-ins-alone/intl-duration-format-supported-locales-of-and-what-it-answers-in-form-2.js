const result = Intl.DurationFormat.supportedLocalesOf("an", 2.5);
console.log(Array.isArray(result), result.length);
