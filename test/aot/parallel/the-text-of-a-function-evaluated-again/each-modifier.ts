// Each modifier that makes a parameter a property, alone and in pairs.
class Ground { kind = "ground"; label = "none"; }
class Plot extends Ground {
  constructor(
    public width: number,
    private depth: number,
    protected owner: string,
    readonly year: number,
    override kind: string,
    private readonly secret: string,
    public override label: string,
    plain: number,
  ) {
    super();
    this.width += plain;
  }
  area() { return this.width * this.depth; }
  told() { return this.owner + this.secret; }
}
const Again = (0, eval)("(function (Ground) { return (" + String(Plot) + "); })")(Ground);
for (const Made of [Plot, Again]) {
  const plot = new Made(2, 3, "ann", 1999, "plot", "s", "west", 10);
  console.log(JSON.stringify(plot), Object.keys(plot).join(), plot.area(), plot.told(), "plain" in plot);
}
for (const name of ["width", "depth", "owner", "year", "kind", "secret", "label"]) console.log(name, String(Plot).includes("this." + name + " = " + name));
console.log(String(Plot).includes("this.plain"));
