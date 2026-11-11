const printValue = console.log;
// z2a28mqzp
let heard1 = 0;
function show1(answer: any): string { return typeof answer === "function" ? "function" : String(answer); }
function Top1(this: any) { this.size = 1; }
Top1.prototype.tell = function () { return 1; };
function Mid1(this: any) { Top1.call(this); this.more = 2; }
Object.setPrototypeOf(Mid1.prototype, Top1.prototype);
function Low1(this: any) { Mid1.call(this); }
Low1.prototype = Object.create(Mid1.prototype);
const top1: any = new (Top1 as any)();
const mid1: any = new (Mid1 as any)();
const low1: any = new (Low1 as any)();
function ask1(who: any): any {  return JSON.stringify(who); }
try { printValue("before 1", [show1(ask1(top1)), show1(ask1(mid1)), show1(ask1(low1))].join("|"), heard1); } catch (error) { printValue("before 1", (error as any).name); }
try { for (let turn = 0; turn < 3; turn++) { if (turn === 1) { (Mid1.prototype as any).tell = () => 9; } } } catch (error) { heard1 += 10; }
try { printValue("behind 1", [show1(ask1(top1)), show1(ask1(mid1)), show1(ask1(low1))].join("|"), heard1); } catch (error) { printValue("behind 1", (error as any).name); }
try { for (let turn = 0; turn < 3; turn++) { if (turn === 1) { Object.defineProperty((Mid1.prototype as any), "tell", { get() { return 9; }, configurable: true }); } } } catch (error) { heard1 += 10; }
try { printValue("at last 1", [show1(ask1(top1)), show1(ask1(mid1)), show1(ask1(low1))].join("|"), heard1); } catch (error) { printValue("at last 1", (error as any).name); }
export {};
