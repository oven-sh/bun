// constructs an heir of a class of 45 fields whose prototype may gain members and whose last three fields are optional
function chunk(x: number): number {
  return x + 1;
}
interface Core {
  refresh?: () => number;
}
class Core {
  count = 0;
  plain0 = 0;
  plain1 = 1;
  plain2 = 2;
  plain3 = 3;
  plain4 = 4;
  plain5 = 5;
  plain6 = 6;
  plain7 = 7;
  plain8 = 8;
  plain9 = 9;
  plain10 = 10;
  plain11 = 11;
  plain12 = 12;
  plain13 = 13;
  plain14 = 14;
  plain15 = 15;
  plain16 = 16;
  plain17 = 17;
  plain18 = 18;
  plain19 = 19;
  plain20 = 20;
  plain21 = 21;
  plain22 = 22;
  plain23 = 23;
  plain24 = 24;
  plain25 = 25;
  plain26 = 26;
  plain27 = 27;
  plain28 = 28;
  plain29 = 29;
  unset0!: string;
  unset1!: string;
  unset2!: string;
  unset3!: string;
  unset4!: string;
  unset5!: string;
  unset6!: string;
  unset7!: string;
  arrow = (x: number) => x + this.count;
  loadChunk = chunk;
  ssr?: { m: number };
  serverSsr?: { m: number };
  lifecycle?: { m: number };
  constructor(count: number) {
    this.count = count;
  }
}
class Router extends Core {
  constructor(count: number) {
    super(count);
  }
}
if (process.argv.length > 50) {
  Core.prototype.refresh = function () {
    return 1;
  };
}
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += new Router(i).count;
}

console.log(sum);
