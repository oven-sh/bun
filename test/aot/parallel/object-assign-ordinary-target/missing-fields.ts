// Fields of the source that were deleted, never stored or hold undefined.
class Options {
  alpha?: number;
  beta?: string;
  gamma: number | undefined = undefined;
  constructor(fill: number) {
    if (fill & 1) this.alpha = fill;
    if (fill & 2) this.beta = "b" + fill;
  }
}
const proto = { kind: "p" };
for (let round = 0; round < 12; round++) {
  const source = new Options(round & 3);
  if (round % 5 === 4) delete (source as { gamma?: number }).gamma;
  const made = Object.assign(Object.create(proto), source);
  console.log(round, Object.keys(made).join(), JSON.stringify(made), "gamma" in made, "alpha" in made);
}
