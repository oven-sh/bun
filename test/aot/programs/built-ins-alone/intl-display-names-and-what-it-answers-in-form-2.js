const second = { type: "region" };
const result = new Intl.DisplayNames(1.5, second);
console.log(typeof result, Object.keys(result).join());
