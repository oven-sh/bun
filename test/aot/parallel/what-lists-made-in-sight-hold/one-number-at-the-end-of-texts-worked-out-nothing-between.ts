class P { x: number; constructor(x: number) { this.x = x; } }
class Q { y: string = "why"; z: number = 0.5; x: number; constructor(x: number) { this.x = x; } }
const hidden: any = (globalThis as any);
hidden.touch = (list: any[], at: number, value: any) => { list[at] = value; };
function show(make: () => unknown) { try { console.log(String(make())); } catch (error) { console.log((error as Error).constructor.name); } }
function straight(a: number, b: number, k: number) {
  const first: any = new P(1);
  const t: any[] = ["n" + a, "m" + b, "k" + a + b, a + b];
  
  const e = t[k & 3];
  return e.length + 1;
}
function inALoop(a: number, b: number, k: number) {
  const first: any = new P(1);
  const t: any[] = ["n" + a, "m" + b, "k" + a + b, a + b];
  let all = "";
  for (let turn = 0; turn < 6; turn++) {
    const e = t[turn & 3];
    all += (e.length + 1) + ",";
    if (turn === k) {  }
  }
  return all;
}
for (let k = 0; k < 5; k++) { show(() => straight(2, 0.5, k)); show(() => inALoop(2, 0.5, k)); }
