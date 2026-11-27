// Under: --aot-check=Validate: the code verifier rejected this loop because of an edge into its header that nothing reaches
// Under: --aot-testing=CheckBoundsAtRunTime: every read of the typed array is checked against its bounds
// The counter starts at -2, at -1 and at 0. The bytes around the view are all 99, so a read outside it would change the sum from NaN.
class Mixer {
  weights: any;
  total: any;
  constructor(weights: any) {
    this.weights = weights;
    this.total = 0;
  }
  mix(samples: any): any {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = pass - 2; i < 40; i++) {
        this.total += this.weights[i + 2] * samples[i];
      }
    }
    return this.total;
  }
}

function hide(value: any): any {
  return JSON.parse("0", () => value);
}

const weights = JSON.parse(`[${Array.from({ length: 60 }, (_, index) => index + 0.25).join()}]`);
const samples = new Uint8Array(new Uint8Array(256).fill(99).buffer, 100, 40);
console.log(String(new Mixer(weights).mix(hide(samples))));
console.log(Array.from(samples).slice(0, 4).join());
