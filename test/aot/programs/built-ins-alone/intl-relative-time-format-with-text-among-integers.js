const result = new Intl.RelativeTimeFormat(1.5, "text");
console.log(typeof result, Object.keys(result).join());
