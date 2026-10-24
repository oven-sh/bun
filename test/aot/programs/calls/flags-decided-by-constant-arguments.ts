const parsed: any = JSON.parse('{"kind":3,"deep":true,"text":"deep"}');

function visit(a: number, deep: boolean, callback: ((n: number) => number) | undefined): number {
  if (deep) {
    a = a + 1;
    if (callback) {
      let t = 0;
      for (let i = 0; i < 4; i++) {
        t += callback(a + i) ^ (t >>> 3);
        t += Math.imul(t, 17) + (i % 7);
        t ^= (t << 5) + (i & 255);
        t += Math.abs(t - i) % 1021;
      }
      a = t;
    }
  }
  return a;
}

class Walker {
  count: number;
  constructor(kind: number, deep: boolean) {
    this.count = kind;
    if (deep) {
      let t = 0;
      for (let i = 0; i < kind; i++) {
        t += (i * 31) ^ (t >>> 3);
        t += Math.imul(t, 17) + (i % 7);
        t ^= (t << 5) + (i & 255);
        t += Math.abs(t - i) % 1021;
      }
      this.count = t;
    }
  }
}

class Chooser {
  count: number;
  constructor(kind: number, n: number) {
    switch (kind) {
      case 0:
        this.count = n + 1;
        break;
      case 1:
        this.count = n * 3;
        break;
      default:
        this.count = -n;
    }
  }
}

const twice = (n: number) => n * 2;
let total = 0;
for (let i = 0; i < 50; i++) {
  total += visit(i, false, twice);
  total += visit(i, true, undefined);
  total += visit(i & 3, true, twice) & 1023;
  total += visit(i, (i & 7) === 7, (i & 1) ? twice : undefined) & 1023;
  total += new Walker(i & 15, false).count;
  total += new Walker(i & 3, true).count & 1023;
  total += new Chooser(0, i).count + new Chooser(1, i).count + new Chooser(2, i).count + new Chooser(i & 3, i).count;
}
console.log(total, new Walker(parsed.kind, parsed.deep).count, new Walker(parsed.text, parsed.text).count, new Chooser(parsed.kind, parsed.kind).count, new Chooser(parsed.text, 4).count);
