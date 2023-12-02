const fs = require("fs");

const path = require("path");
const PROJECT = process.env.PROJECT || "bun";
const percentile = require("percentile");
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const label = `${PACKAGE_NAME}@${require(PACKAGE_NAME + "/package.json").version}`;

const BASEFOLDER = path.resolve(PROJECT);
const OUTFILE = path.join(process.cwd(), process.env.OUTFILE);

const buf = fs.readFileSync(BASEFOLDER + "/colors.css.blob");
const VALID_TIMES = new BigUint64Array(buf.buffer).subarray(1);
const cssFileSize = new BigUint64Array(buf.buffer)[0];

const TOTAL_FRAMES = VALID_TIMES.length;

const timings = fs
  .readFileSync(BASEFOLDER + "/frames.all.clean", "utf8")
  .split("\n")
  .map(a => a.replace(/[Ran:'\.]?/gm, "").trim())
  .filter(a => parseInt(a, 10))
  .filter(a => a.length > 0 && VALID_TIMES.includes(BigInt(parseInt(a, 10))))
  .map(num => BigInt(num));

timings.sort();

const frameTimesCount = timings.length;

var frameTime = new Array(Math.floor(frameTimesCount / 2));

for (let i = 0; i < frameTime.length; i++) {
  const i1 = i * 2;
  const i2 = i * 2 + 1;

  frameTime[i] = Math.max(Number(timings[i2] - timings[i1]), 0);
}

const report = {
  label,
  cssFileSize: Number(cssFileSize),
  at: new Date().toISOString(),
  sleep: process.env.SLEEP_INTERVAL,
  package: {
    name: PACKAGE_NAME,
    version: require(PACKAGE_NAME + "/package.json").version,
  },
  timestamps: timings.map(a => Number(a)),
  frameTimes: frameTime,
  percentileMs: {
    50: percentile(50, frameTime) / 10,
    75: percentile(75, frameTime) / 10,
    90: percentile(90, frameTime) / 10,
    95: percentile(95, frameTime) / 10,
    99: percentile(99, frameTime) / 10,
  },
};

fs.writeFileSync(
  path.join(
    path.dirname(OUTFILE),
    path.basename(OUTFILE) +
      "@" +
      report.package.version +
      "." +
      process.env.SLEEP_INTERVAL +
      "ms." +
      `${process.platform}-${process.arch === "arm64" ? "aarch64" : process.arch}` +
      ".json",
  ),
  JSON.stringify(report, null, 2),
);

console.log(
  label + "\n",
  "-".repeat(50) + "\n",
  "CSS HMR FRAME TIME\n" + "\n",

  "50th percentile:",
  percentile(50, frameTime) / 10 + "ms",
  "\n",
  "75th percentile:",
  percentile(75, frameTime) / 10 + "ms",
  "\n",
  "90th percentile:",
  percentile(90, frameTime) / 10 + "ms",
  "\n",
  "95th percentile:",
  percentile(95, frameTime) / 10 + "ms",
  "\n",
  "99th percentile:",
  percentile(99, frameTime) / 10 + "ms",
  "\n",
  "Rendered frames:",
  timings.length,
  "/",
  TOTAL_FRAMES,
  "(" + Math.round(Math.max(Math.min(1.0, timings.length / TOTAL_FRAMES), 0) * 100) + "%)",
);
