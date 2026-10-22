const result = Intl.supportedValuesOf("unit");
console.log(Array.isArray(result), result.length, typeof result[0], typeof result[1], typeof result[2]);
console.log(typeof result[3]);
