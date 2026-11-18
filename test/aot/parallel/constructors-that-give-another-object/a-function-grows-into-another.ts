// Two functions of TypeScript: the first gives an instance of the second where a number has grown.
interface Amount { value: number; plus(by: number): Amount; }
function Small(this: any, value: number) {
  if (value > 1e6) return new (Large as any)(value);
  this.value = value;
}
function Large(this: any, value: number) { this.value = value; this.digits = String(value).length; }
Small.prototype.plus = function (by: number): Amount { return new (Small as any)(this.value + by); };
Large.prototype.plus = function (by: number): Amount { return new (Large as any)(this.value + by); };
let amount: Amount = new (Small as any)(JSON.parse('999990'));
for (let i = 0; i < 40; i++) amount = amount.plus(i);
console.log(amount.value, (amount as any).digits, amount instanceof (Large as any));
let sum = 0;
for (let i = 0; i < 300; i++) sum += new (Small as any)(999900 + i).value;
console.log(sum);
