// STATISTIC: ArraysGuardedUnderSpeculatedCounters >= 1
const rounds = +process.argv[2]! || 3;
const say = (x: unknown) => Object.is(x, -0) ? "-0" : String(x);
function up(list: any, i: any, t: any): any { while (list[i] < t) i++; return i; }
const lists: any[] = JSON.parse('[[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5],[0,1,2,3,4,5,6,7],["a","b","c","d","e"],[0.5,1.5,null,3.5],[],[{"v":1},{"v":2}]]');
const holed: any[] = [0.5, 1.5, , 3.5, 4.5];
lists.push(holed, new Float64Array([0.5, 1.5, 2.5, 3.5]), "abcdef", { 0: 0.5, 1: 1.5, length: 2 });
const starts: any[] = JSON.parse('[0,1,3,0.5,-1,-0,7,8,100,2147483647,2147483648,4294967295,4294967296,-2147483649,"0","2","x",null,true]');
starts.push(NaN, Infinity, -Infinity, undefined);
const bounds: any[] = [4, 2.5, "c", NaN, 1e9];
const out: string[] = [];
for (let r = 0; r < rounds; r++) for (const list of lists) for (const s of starts) out.push(say(up(list, s, bounds[(r + out.length) % bounds.length])));
console.log(out.join(" "));
