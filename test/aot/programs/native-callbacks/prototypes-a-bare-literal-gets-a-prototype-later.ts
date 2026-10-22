// A literal under null finds nothing of Object.prototype until somebody puts it under an object. A store to `__proto__` finds no setter there: it makes an own property.
class Shape {
  sides = 4;
  describe(): string {
    return "sides " + (this as any).sides;
  }
}

const first: any = { __proto__: null, sides: 3 };
console.log(typeof first.toString, typeof first.describe, first.sides);
first.__proto__ = Shape.prototype;
console.log(typeof first.describe, Object.getPrototypeOf(first), Object.keys(first).join());

const second: any = { __proto__: null, sides: 5 };
Object.setPrototypeOf(second, Shape.prototype);
console.log(second.describe(), second instanceof Shape, typeof second.toString);

const third: any = { __proto__: null, sides: 6 };
Reflect.setPrototypeOf(third, second);
console.log(third.describe(), typeof third.hasOwnProperty, Object.getPrototypeOf(third) === second);

const fourth: any = { __proto__: null, sides: 7 };
(Object.prototype as any).__lookupSetter__("__proto__").call(fourth, Shape.prototype);
console.log(fourth.describe());
