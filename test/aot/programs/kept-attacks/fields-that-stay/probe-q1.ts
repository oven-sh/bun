// Fields that stay, one probe of many. It prints what plain Bun prints.
interface Reading { level: number }
const reading: Reading = { level: 1 };
console.log(reading.level);
