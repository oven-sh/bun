// Under: --aot-check=Validate: the code verifier rejected this loop because of an edge into its header that nothing reaches
// Under: --aot-testing=CheckBoundsAtRunTime: every read of the typed array is checked against its bounds
// The counter starts at the pass and steps by two.
class Mixer {
  weights: any;
  total: any;
  constructor(weights: any) {
    this.weights = weights;
    this.total = 0;
  }
  mix(samples: any): any {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = pass; i < 40; i += 2) {
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
const samples = new Int16Array(new Int16Array(128).fill(7).buffer, 64, 40);
console.log(String(new Mixer(weights).mix(hide(samples))));
console.log(Array.from(samples).slice(0, 4).join());
