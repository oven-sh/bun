// A decorator on a parameter of a constructor is run by the helper that decorates the class: it is handed the class, and what it answers is stored under the name of the class.
// So the name is stored to twice, whoever holds it: a function that captures it, the module, a function that nobody captures it from. And a decorator that answers something replaces the class.
function captured() {
  const seen: boolean[] = [];
  class Happy { constructor(@d1 public width: number) {} }
  function d1(target: any, key: any, index: number) { seen.push(target === Happy, key === undefined, index === 0); }
  return [new Happy(3).width, seen];
}
console.log(captured());

function notCaptured() {
  let counter = 0;
  class Happy { width: number; constructor(@d1 width: number, @d1 @d1 height: number) { this.width = width + height; } }
  function d1(target: any, key: any, index: number) { counter += index + 1; }
  return [new Happy(3, 4).width, counter];
}
console.log(notCaptured());

function replaced() {
  class Other { width = "other"; }
  class Happy { constructor(@swap public width: number) {} }
  function swap(target: any, key: any, index: number): any { return Other; }
  function make() { return new Happy(3); }
  return [make().width, Happy === (Other as any), make() instanceof Other, Happy.name];
}
console.log(replaced());

const order: string[] = [];
function note(name: string) { return (target: any, key: any, index: number) => { order.push(name + " " + index + " " + typeof target); }; }
class AtTheTop { constructor(@note("first") public a: number, @note("second") public b: number) {} sum() { return this.a + this.b; } }
function makeAtTheTop() { return new AtTheTop(1, 2); }
console.log(makeAtTheTop().sum(), order.join(), makeAtTheTop() instanceof AtTheTop);

class Below extends AtTheTop { constructor(@note("below") c: number) { super(c, c); } }
console.log(new Below(5).sum(), order.join(), new Below(1) instanceof AtTheTop);

const expression = class Named { constructor(@note("expression") public a: number) {} self() { return Named; } };
console.log(new expression(1).self() === expression, order.length);
