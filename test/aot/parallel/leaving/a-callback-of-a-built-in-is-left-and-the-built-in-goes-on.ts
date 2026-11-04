// map, reduce, sort and forEach call a function whose parameter is now and then a literal
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Coin { cents: number; constructor(cents: number) { this.cents = cents; } }
const log: number[] = [];
const coins: any[] = [];
for (let i = 0; i < 40; i++) coins.push(i % 6 === 3 ? { cents: 100 + i } : new Coin(i));
function worth(coin: Coin, index: number): number { log.push(index); return coin.cents * 2 + index; }
function add(sum: number, coin: Coin): number { return sum + coin.cents; }
function order(a: Coin, b: Coin): number { return b.cents - a.cents; }
const run = through((list: Coin[]) => { let seen = 0; list.forEach((coin: Coin) => { seen += coin.cents & 3; }); return [list.map(worth).join(), list.reduce(add, 0), list.slice().sort(order).map((coin: Coin) => coin.cents).slice(0, 9).join(), seen].join(" | "); });
console.log(run(coins), log.length);
