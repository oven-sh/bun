const lower = JSON.parse(JSON.stringify("нижний регистр")), digits = JSON.parse(JSON.stringify("中文 123"));
const map = new Map([[lower, 1], [digits, 2]]);
console.log(map.get(lower.toLowerCase()), map.get(digits.toUpperCase()), map.get(digits.toLowerCase()), lower.toLowerCase() === lower, Object.is(digits.toUpperCase(), digits), lower.toUpperCase() === lower);
