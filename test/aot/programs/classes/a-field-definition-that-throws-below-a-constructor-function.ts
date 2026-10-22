// A class below a constructor function: its declared number fields are filled by the constructor, and where the function answers an object that takes no new property, the field defined before the error holds undefined.
function Emitter(this: any) {
  this.listeners = 0;
}
const EmitterClass = Emitter as unknown as new () => { listeners: number };
class Below extends EmitterClass {
  a: number;
  b: number;
  constructor(n: number) {
    super();
    this.a = n;
    this.b = n + 1;
  }
}
const closed: any = Object.preventExtensions({ a: 1 });
function AnswersClosed(this: any) {
  return closed;
}
const AnswersClosedClass = AnswersClosed as unknown as new () => object;
class OnClosed extends AnswersClosedClass {
  a: number;
  b: number;
  constructor() {
    super();
    this.a = 1;
    this.b = 2;
  }
}
function runBelow(turns: number): number {
  const kept: Below[] = [];
  for (let i = 0; i < 8; i++) kept.push(new Below(i));
  let total = 0;
  for (let i = 0; i < turns; i++) {
    kept[i & 7] = new Below(i & 1023);
    total = (total + kept[(i + 3) & 7].a + kept[(i + 5) & 7].b) & 0xffff;
  }
  return total;
}
const turns = Number(process.env.TURNS ?? 1000) | 0;
console.log(runBelow(turns));
try {
  new OnClosed();
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(closed.a);
