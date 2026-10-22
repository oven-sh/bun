// Fields that stay, one probe of many. It prints what plain Bun prints.
interface Reading { level: number }
const reading: Reading = { level: 1 };
const untyped: any = reading;
console.log(untyped.level);
