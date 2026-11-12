const printValue = console.log;
const shown1 = (value: any): string => (typeof value === "function" ? value() + "," + value() : String(value));
const unknown1: any = (globalThis as any).swap1 ?? ((found: any) => String(found).toUpperCase());
class K1_0 { v: any = 0; includes(given: any): any { return "0:" + this.v + ":" + given; } }
class K1_1 extends K1_0 { includes(given: any): any { return "1:" + this.v + ":" + given; } }
class K1_2 extends K1_0 { }
class K1_3 extends K1_0 { p3_0: any = 0; includes(given: any): any { return "3:" + this.v + ":" + given; } }
function one1(each: any, given: any): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return String(each.v) + work; }
function ask1(list: any[], given: any): string { return [one1(list[0], given), one1(list[1], given), one1(list[2], given), one1(list[3], given), one1(list[4], given)].join(";"); }
const list1: any[] = [new K1_0(), new K1_1(), new K1_2(), new K1_3(), Object.setPrototypeOf({ v: "adopted" }, K1_3.prototype)];
try { printValue("dispatch 1", ask1(list1, 1)); } catch (error) { printValue("dispatch 1", (error as any).name); }
function change1() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; (list1[0] as any).includes = (given: any) => "own:" + given; return work; }
try { change1(); } catch (error) { printValue("dispatch 1", "the deed threw"); }
try { printValue("dispatch behind 1", ask1(list1, unknown1)); } catch (error) { printValue("dispatch behind 1", (error as any).name); }
export {};
