// A tagged template in an arrow function has one template object, whether the argument of the call fits its type or not.
declare const console: { log(...a: unknown[]): void };
const site = (o: { a: number }) => ((s: TemplateStringsArray) => s)`x`;
console.log(site({ a: 1 }) === (site as any)({}));
