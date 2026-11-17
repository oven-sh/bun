const printValue = console.log;
const shown1 = (value: any): string => (typeof value === "function" ? value() + "," + value() : String(value));
const unknown1: any = (globalThis as any).swap1 ?? ((found: any) => String(found).toUpperCase());
class K1_0 { v: any = 0.5; concat(given: any): any { return "0:" + this.v + ":" + given; } }
class K1_1 { v: any = 1; concat(given: any): any { return "1:" + this.v + ":" + given; } }
class K1_2 { p2_0: any = 0; p2_1: any = 1; v: any = 2; concat(given: any): any { return "2:" + this.v + ":" + given; } }
class K1_3 { p3_0: any = 0; v: any = 3; concat(given: any): any { return "3:" + this.v + ":" + given; } }
function one1(each: any, given: any): string { return String(each.v) + "/" + shown1(each.concat(given)); }
function ask1(list: any[], given: any): string { let out = ""; for (const each of list) out += one1(each, given) + ";"; return out; }
const list1: any[] = [new K1_0(), new K1_1(), new K1_2(), new K1_3()];
try { printValue("dispatch 1", ask1(list1, 1)); } catch (error) { printValue("dispatch 1", (error as any).name); }
try { (list1[0] as any).more = 1; delete (list1[0] as any).v; } catch (error) { printValue("dispatch 1", "the deed threw"); }
try { printValue("dispatch behind 1", ask1(list1, 1)); } catch (error) { printValue("dispatch behind 1", (error as any).name); }
try { printValue("dispatch by name 1", shown1(new K1_3().concat("g"))); } catch (error) { printValue("dispatch by name 1", (error as any).name); }
export {};
