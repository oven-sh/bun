const begin = async () => 5;
const first = await begin();
const second = await Promise.resolve(first + 1);
console.log("two-awaits ran", first, second);
export const name = "two-awaits";
