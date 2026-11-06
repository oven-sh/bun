// Flags: --aot-log-type-mismatches
// STATISTIC: TypedResultsSelected >= 10
interface Config {
  port: number;
  host: string;
  tags?: string[];
}
interface Point {
  x: number;
  y: number;
  label?: string;
  weight?: number;
}
interface Left {
  id: number;
  left?: string;
}
interface Right {
  id: number;
  right?: string;
}

const n = process.argv.length;
const showConfig = (config: Config) => `${config.port} ${config.host} ${config.tags?.join()} ${Object.keys(config)} ${JSON.stringify(config)}`;
const showPoint = (point: Point) => `${point.x} ${point.y} ${point.label} ${point.weight} ${Object.keys(point)} ${JSON.stringify(point)}`;
const showLeft = (value: Left) => `${value.id} ${value.left} ${Object.keys(value)} ${JSON.stringify(value)}`;
const showRight = (value: Right) => `${value.id} ${value.right} ${Object.keys(value)} ${JSON.stringify(value)}`;

const makeConfig = () => ({ port: -n, host: "own" });
const makePoint = () => ({ x: n, y: -n });
const makeLabeled = () => ({ x: n, y: -n, label: "made" });
const makeBare = () => ({ id: n });

for (let round = 0; round < 3; round++) {
  console.log(showConfig(JSON.parse(`{"port":${n + round + 0.5},"host":"h${n}"}`) as Config));
  console.log(showConfig(JSON.parse(`{"host":"g${n}","tags":["a","b${round}"],"port":${n}}`) as Config));
  console.log(showConfig(JSON.parse(`{"port":${n},"host":"e","extra":${round}}`) as Config));
  console.log(showConfig(makeConfig()));

  console.log(showPoint(JSON.parse(`{"x":${round},"y":${n}}`) as Point));
  console.log(showPoint(JSON.parse(`{"x":${round},"y":${n},"weight":0.5}`) as Point));
  console.log(showPoint(JSON.parse(`{"label":"l${round}","y":${n},"x":1}`) as Point));
  console.log(showPoint(makePoint()), showPoint(makeLabeled()));

  console.log(showLeft(JSON.parse(`{"id":${round},"left":"l"}`) as Left), showRight(JSON.parse(`{"id":${round},"right":"r"}`) as Right));
  console.log(showLeft(JSON.parse(`{"id":${round},"right":"r"}`) as Left), showRight(JSON.parse(`{"id":${round},"left":"l"}`) as Right));
  console.log(showLeft(makeBare()), showRight(makeBare()));
}
