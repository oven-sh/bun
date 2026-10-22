const result = Intl.DateTimeFormat.supportedLocalesOf(1.5, "text");
console.log(Array.isArray(result), result.length);
