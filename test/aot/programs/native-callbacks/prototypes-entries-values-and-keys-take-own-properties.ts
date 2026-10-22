// Object.entries, values and keys list own enumerable properties: nothing that is inherited, and an own property may have the name of a member of Object.prototype.
class Point {
  x = 1;
  y = 2;
  norm(): number {
    return this.x + this.y;
  }
}

let sum = 0;
const point = new Point();
Object.entries(point).forEach(([name, value]) => { sum += (value as number) * name.length; });
Object.entries({ __proto__: point, z: 3 }).forEach(([, value]) => { sum += 10 * (value as number); });
Object.entries({ a: point }).forEach(([, held]) => { held.x++; sum += 100 * held.norm(); });
Object.values({ toString: point, constructor: point }).forEach(held => { held.y++; sum += 1000 * held.norm(); });
console.log(sum, point.x, point.y, Object.keys({ __proto__: point }).length, Object.entries(Object.create(point)).length);
const shadowing: any = { __proto__: null, toString: () => "own", hasOwnProperty: 1 };
console.log(Object.entries(shadowing).map(([name, value]) => name + ":" + typeof value).join(), `${shadowing}`);
