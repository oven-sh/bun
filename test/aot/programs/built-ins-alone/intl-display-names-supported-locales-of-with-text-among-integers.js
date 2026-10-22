const result = Intl.DisplayNames.supportedLocalesOf(1.5, "text");
console.log(Array.isArray(result), result.length);
