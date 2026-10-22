const shape = { alpha: 1, beta: 2, gamma: 3 };
type Values = { [K in keyof typeof shape]: number };
const above = { platform: "here" };
let reads = 0;
function build(proto: object): Record<string, unknown> {
  const made = Object.create(proto) as Record<string, unknown>;
  for (const [key, value] of Object.entries(shape)) {
    Object.defineProperty(made, key, { get: () => (reads++, value * 10), enumerable: true, configurable: true });
  }
  return made;
}
const settings = build(above) as Values & typeof above;
function pick(): number {
  const before = [1, 2, 3].map(n => n * 2);
  const first = settings.alpha ? settings.beta : settings.gamma;
  return first + before.length + settings.platform.length;
}
console.log(pick(), pick(), reads);
const copy = { ...settings };
console.log(Object.keys(copy).join(), copy.alpha, copy.platform, reads, "platform" in copy);
