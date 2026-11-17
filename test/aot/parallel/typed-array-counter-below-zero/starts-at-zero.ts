// Under: --aot-check=Validate: the code verifier rejected this loop because of an edge into its header that nothing reaches
// Under: --aot-testing=CheckBoundsAtRunTime: every read of the typed array is checked against its bounds
// The view is shorter than the loop.
class Mixer {
  weights: any;
  total: any;
  constructor(weights: any) {
    this.weights = weights;
    this.total = 0;
  }
  mix(samples: any): any {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 40; i++) {
        this.total += this.weights[i] * samples[i];
      }
    }
    return this.total;
  }
}

function hide(value: any): any {
  return JSON.parse("0", () => value);
}

const weights = JSON.parse(`[${Array.from({ length: 60 }, (_, index) => index + 0.25).join()}]`);
const samples = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
console.log(String(new Mixer(weights).mix(hide(samples))));
console.log(Array.from(samples).slice(0, 4).join());
