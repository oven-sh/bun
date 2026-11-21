const seen = [];
for (const value of [1, 2]) seen.push(value);
export const kBrand = Symbol("brand");
export class Shape { area() { return seen.length; } }
Object.defineProperty(Shape.prototype, kBrand, { value: true });
console.log(new Shape().area());
class Own { area() { return 3; } }
Object.defineProperty(Own.prototype, Symbol("own"), { value: 1 });
console.log(new Own().area(), Object.getOwnPropertySymbols(Own.prototype).length);
