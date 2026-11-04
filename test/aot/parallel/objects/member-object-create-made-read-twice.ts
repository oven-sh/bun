// An object made by Object.create() stands where a class is declared, and a member is read from it through `any`, twice over. The field of the literal below it holds integers or nothing, while the read expects no more than a number.
class Bag {
  list: number[];
  a: number;
  constructor(list: number[]) {
    this.list = list;
    this.a = list[0];
  }
  sum(): number {
    return this.list.length;
  }
}

function show(value: any, depth: number = 0): string {
  if (value === null) return "null";
  if (typeof value === "object") {
    if (depth > 3) return "{..}";
    let text = "{";
    for (const key of Object.keys(value)) text += key + ":" + show(value[key], depth + 1) + ",";
    return text + "}";
  }
  return typeof value + ":" + String(value);
}

let last = "";

// @ts-ignore
function readsDeep(n: number, bag: Bag = Object.create({ a: n, sum() { return 5; } })) { return (bag as any)?.a?.a; }
function mainReadsDeep(n: number) { return readsDeep(n, n % 10 === 7 ? Object.create({ a: n, sum() { return 5; } }) : undefined); }
function attemptReadsDeep(n: number) { try { return show(mainReadsDeep(n)); } catch (error) { return "threw " + (error as Error).name; } }
for (let n = 0; n < 1000; n++) { last = attemptReadsDeep(n); if (n < 12 || n === 27) console.log("reads deep", n, last); }

// Nothing declares the function.
// @ts-ignore
function mainHandsOn(n: number) { return declaredNowhere(n, n % 10 === 7 ? Object.create({ a: n, sum() { return 5; } }) : undefined); }
function attemptHandsOn(n: number) { try { return show(mainHandsOn(n)); } catch (error) { return "threw " + (error as Error).name; } }
for (let n = 0; n < 1000; n++) { last = attemptHandsOn(n); if (n < 12 || n === 27) console.log("hands on", n, last); }

// @ts-ignore
function spreadsAndAdds(n: number, bag: Bag = Object.create({ a: n, sum() { return 5; } })) { return { ...bag, c: n }; }
function mainSpreadsAndAdds(n: number) { return spreadsAndAdds(n, n % 10 === 7 ? Object.create({ a: n, sum() { return 5; } }) : undefined); }
function attemptSpreadsAndAdds(n: number) { try { return show(mainSpreadsAndAdds(n)); } catch (error) { return "threw " + (error as Error).name; } }
for (let n = 0; n < 1000; n++) { last = attemptSpreadsAndAdds(n); if (n < 12 || n === 27) console.log("spreads and adds", n, last); }
console.log(last);
