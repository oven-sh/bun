const result = Intl.DisplayNames.supportedLocalesOf("an", 2.5);
console.log(Array.isArray(result), result.length);
