// Six classes override one method, which is more than a switch on the class takes: the call finds the method by the object's class.
// Then each method is replaced under a name that only the run knows, one is deleted, the base gets one that returns text, an object gets a method of its own and another object gets another prototype:
// every call from then on finds what plain JavaScript finds.
abstract class Shape {
  r: number;
  constructor(r: number) { this.r = r; }
  abstract size(): number;
}
class S1 extends Shape { size(): number { return this.r * 1.5; } }
class S2 extends Shape { size(): number { return this.r * 2.5; } }
class S3 extends Shape { size(): number { return this.r * 3.5; } }
class S4 extends Shape { size(): number { return this.r * 4.5; } }
class S5 extends Shape { size(): number { return this.r * 5.5; } }
class S6 extends Shape { size(): number { return this.r * 6.5; } }
function each(list: Shape[]): string {
  let text = "";
  for (const shape of list) {
    try {
      text += " " + shape.size();
    } catch (error) {
      text += " " + (error instanceof TypeError ? "TypeError" : "error");
    }
  }
  return text;
}
function total(list: Shape[]): number {
  let sum = 0;
  for (const shape of list) sum += shape.size();
  return sum;
}
const list: Shape[] = [new S1(1), new S2(2), new S3(3), new S4(4), new S5(5), new S6(6)];
for (let round = 0; round < 3; round++) console.log("as written", each(list), total(list));
const name = ["si", "ze"].join("");
const classes = [S1, S2, S3, S4, S5, S6];
for (const [index, one] of classes.entries()) {
  (one.prototype as any)[name] = function (this: Shape) { return -this.r - index; };
  console.log("replaced in class", index + 1, each(list), total(list));
}
delete (S3.prototype as any)[name];
console.log("deleted in class 3", each(list));
(Shape.prototype as any)[name] = () => "text";
console.log("the base returns text", each(list), total(list));
Object.defineProperty(list[0], name, { value: () => 1000, configurable: true });
console.log("an own method", each(list), total(list));
Object.setPrototypeOf(list[1], S6.prototype);
console.log("another prototype", each(list), total(list));
const fresh: Shape[] = [new S1(7), new S2(8), new S3(9), new S4(10), new S5(11), new S6(12)];
console.log("new objects", each(fresh), total(fresh));
