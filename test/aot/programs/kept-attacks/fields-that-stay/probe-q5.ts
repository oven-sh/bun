// Fields that stay, one probe of many. It prints what plain Bun prints.
interface Reading { level: number; depth: number }
const make = (): any => { const reading: Reading = { level: 1, depth: 2 }; return reading; };
console.log(delete make().level);
