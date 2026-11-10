function mix(list: any[]): number {
  let hash = 1;
  for (let at = 0; at < list.length; at++) hash = Math.imul(hash, 33) ^ Math.imul(list[at], 3);
  return hash;
}

const lists: any[][] = [];
let calls = 0;
for (let odd = 0; odd < 20; odd++) {
  const whole: any[] = [];
  for (let at = 0; at < 20; at++) whole.push(at + 1);
  const fraction = whole.slice(); fraction[odd] = 2.75;
  const huge = whole.slice(); huge[odd] = 4294967301;
  const nothing = whole.slice(); nothing[odd] = undefined;
  const text = whole.slice(); text[odd] = "12";
  const hole = whole.slice(); delete hole[odd];
  const counted = whole.slice(); counted[odd] = { valueOf() { calls++; return 5; } };
  lists.push(whole, fraction, huge, nothing, text, hole, counted);
}
let sum = 0;
for (let round = 0; round < 3; round++)
  for (const list of lists) sum = (sum + (mix(list) >>> 0)) % 1000003;
console.log(sum, calls);
