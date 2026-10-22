const second = { type: "region" };
const result = new Intl.DisplayNames("en", second);
console.log(typeof result, Object.keys(result).join());
