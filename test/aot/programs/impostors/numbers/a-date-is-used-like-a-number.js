function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const uses = {
  "date - 0": date => date - 0,
  "+date": date => +date,
  "-date": date => -date,
  "date * 1": date => date * 1,
  "date / 1000": date => date / 1000,
  "date % 1000": date => date % 1000,
  "date | 0": date => date | 0,
  "date >>> 0": date => date >>> 0,
  "typeof (date + 1)": date => typeof (date + 1),
  "typeof (1 + date)": date => typeof (1 + date),
  "(date + 1).length > 10": date => (date + 1).length > 10,
  "date < 5000000000": date => date < 5000000000,
  "date > 5000000000": date => date > 5000000000,
  "date == 4102444800123": date => date == 4102444800123,
  "date === 4102444800123": date => date === 4102444800123,
  "date == String(date)": date => date == String(date),
  "date - date": date => date - date,
  "date == date": date => date == date,
  "date <= date": date => date <= date,
  "date++": date => [date++, date],
  "--date": date => [--date, date],
  "date -= 1": date => (date -= 1),
  "typeof (date += 1)": date => typeof (date += 1),
  "Math.floor(date / 1000)": date => Math.floor(date / 1000),
  "Math.max(date, 0)": date => Math.max(date, 0),
  "Math.min(date, 0)": date => Math.min(date, 0),
  "Number(date)": date => Number(date),
  "isNaN(date)": date => isNaN(date),
  "Number.isNaN(date)": date => Number.isNaN(date),
  "Number.isInteger(date)": date => Number.isInteger(date),
  "new Date(date) - date": date => new Date(date) - date,
  "[1, 2, 3][date]": date => [1, 2, 3][date],
  "[1, 2, 3][date - date]": date => [1, 2, 3][date - date],
  "JSON": date => JSON.stringify({ at: date }),
};

const dates = {
  "a date": () => new Date(4102444800123),
  "the epoch": () => new Date(0),
  "an invalid date": () => new Date(NaN),
  "a date before the epoch": () => new Date(-1),
  "a date with its own valueOf": () => Object.assign(new Date(5), { valueOf: () => 42 }),
  "a date with its own toString": () => Object.assign(new Date(5), { toString: () => "7" }),
  "a subclass that overrides getTime": () => new (class extends Date { getTime() { return 1; } })(5),
  "a subclass that overrides valueOf": () => new (class extends Date { valueOf() { return 99; } })(5),
  "a number": () => 4102444800123,
};

for (const name of Object.keys(uses)) for (let i = 0; i < 300; i++) uses[name](i * 1000);
for (const kind of Object.keys(dates)) for (const name of Object.keys(uses)) attempt(name + " of " + kind, () => uses[name](dates[kind]()));
