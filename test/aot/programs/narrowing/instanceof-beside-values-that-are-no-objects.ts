// `x instanceof Left` where the type of x lists two classes beside false, a number, true, a string or undefined. Left has a class below it; two more classes below the same base exist and arrive under `as`
class Base { tag = 0; }
class Left extends Base { left = 1; }
class LeftMost extends Left { most = 2; }
class Right extends Base { right = 3; }
class Far extends Base { far = 4; }
function besideFalse(x: Left | Right | false): number { return x instanceof Left ? x.left : 0; }
function besideNumber(x: Left | Right | number): number { return x instanceof Left ? x.left + 10 : 0; }
function besideTrue(x: Right | LeftMost | true): number { return x instanceof Right ? x.right : 0; }
function besideString(x: Left | Right | string): number { return x instanceof Left ? x.left + 20 : 0; }
function besideNothing(x?: Left | Right): number { return x instanceof Left ? x.left + 30 : 0; }
const values: unknown[] = [new Left(), new Right(), new LeftMost(), new Far(), new Base(), false, true, 0, 1.5, NaN, "left", "", undefined, null, {}, [], Object.create(Left.prototype), Object.create(null), () => 1, Symbol.iterator, 5n];
for (let round = 0; round < 300; round++) {
  let line = "";
  for (const value of values)
    line += besideFalse(value as Left | false) + "," + besideNumber(value as Left | number) + "," + besideTrue(value as Right | true) + "," + besideString(value as Left | string) + "," + besideNothing(value as Left | undefined) + " ";
  if (round % 149 === 0) console.log(round, line);
}
