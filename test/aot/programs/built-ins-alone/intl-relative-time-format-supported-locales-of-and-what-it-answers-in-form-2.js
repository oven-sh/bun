const result = Intl.RelativeTimeFormat.supportedLocalesOf("an", 2.5);
console.log(Array.isArray(result), result.length);
