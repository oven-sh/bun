function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function Sensor(reading, unit) {
  this.reading = reading;
  this.unit = unit;
}
Sensor.prototype.format = function () {
  return this.reading + " " + this.unit;
};
Sensor.prototype.doubled = function () {
  return this.reading * 2;
};

function formatOf(sensor) {
  return sensor.format();
}

function readingOf(sensor) {
  return sensor.reading;
}

function doubledOf(sensor) {
  return sensor.doubled();
}

function calibrate(sensor) {
  sensor.reading += 1;
  return sensor;
}

const texts = [
  ["the same text", "(function Sensor(reading, unit) { this.reading = reading; this.unit = unit; })", "format() { return this.reading + ' ' + this.unit; }, doubled() { return this.reading * 2; }"],
  ["fields in the other order", "(function Sensor(reading, unit) { this.unit = unit; this.reading = reading; })", "format() { return 'other order ' + this.reading; }, doubled() { return this.reading * 2; }"],
  ["a string reading", "(function Sensor(reading, unit) { this.reading = String(reading); this.unit = unit; })", "format() { return 'string ' + this.reading; }, doubled() { return this.reading + this.reading; }"],
  ["a reading on the prototype", "(function Sensor(reading, unit) { this.unit = unit; })", "reading: 7, format() { return 'shared ' + this.reading; }, doubled() { return this.reading * 2; }"],
  ["a reading that is an accessor", "(function Sensor(reading, unit) { this.kept = reading; this.unit = unit; })", "get reading() { return this.kept * 100; }, set reading(value) { this.kept = value; }, format() { return 'accessor ' + this.reading; }, doubled() { return this.reading * 2; }"],
  ["a class", "(class Sensor { constructor(reading, unit) { this.reading = reading; this.unit = unit; } })", "format() { return 'class ' + this.reading; }, doubled() { return this.reading * 2; }"],
  ["no methods", "(function Sensor(reading, unit) { this.reading = reading; this.unit = unit; })", ""],
];

const arrivals = [
  ["indirect eval", text => (0, eval)(text)],
  ["direct eval", text => eval(text)],
  ["new Function", text => new Function("return " + text + ";")()],
  ["a reviver", text => JSON.parse(JSON.stringify({ text }), (key, value) => (key === "text" ? (0, eval)(value) : value)).text],
];

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const sensor = calibrate(new Sensor(i % 6, "C"));
  sum += formatOf(sensor).length + readingOf(sensor) + doubledOf(sensor);
}
console.log("2000 honest sensors", sum);

for (const [arrival, bring] of arrivals) {
  for (const [label, constructorText, membersText] of texts) {
    const Foreign = bring(constructorText);
    Object.defineProperties(Foreign.prototype, Object.getOwnPropertyDescriptors(bring("({" + membersText + "})")));
    const where = arrival + ", " + label;
    attempt(where + ": made", () => new Foreign(5, "F"));
    attempt(where + ": instanceof the visible Sensor", () => new Foreign(5, "F") instanceof Sensor);
    attempt(where + ": reading", () => readingOf(new Foreign(5, "F")));
    attempt(where + ": format()", () => formatOf(new Foreign(5, "F")));
    attempt(where + ": doubled()", () => doubledOf(new Foreign(5, "F")));
    attempt(where + ": reading += 1", () => { const sensor = calibrate(new Foreign(5, "F")); return [show(sensor), sensor.reading]; });
    attempt(where + ": the visible format with it as this", () => Sensor.prototype.format.call(new Foreign(5, "F")));
    attempt(where + ": the visible constructor with it as this", () => { const sensor = new Foreign(5, "F"); Sensor.call(sensor, 9, "K"); return [show(sensor), sensor.reading]; });
  }
  attempt(arrival + ": honest again", () => [formatOf(calibrate(new Sensor(1, "C"))), doubledOf(new Sensor(2, "C"))]);
}
