// Fields that stay, one probe of many. It prints what plain Bun prints.
interface Reading { level: number }
const make = (): any => { const reading: Reading = { level: 1 }; return reading; };
console.log(make());
