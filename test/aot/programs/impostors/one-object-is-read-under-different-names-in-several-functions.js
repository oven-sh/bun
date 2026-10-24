const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

class Employee {
  constructor(badge, salary, manager) {
    this.badge = badge;
    this.salary = salary;
    this.manager = manager;
  }
}

class Contractor {
  constructor(badge, rate, agency) {
    this.badge = badge;
    this.rate = rate;
    this.agency = agency;
  }
}

function badgeOf(person) {
  return person.badge;
}

function payOf(person) {
  return person.salary;
}

function bossOf(person) {
  return person.manager;
}

function bossBadgeOf(person) {
  return badgeOf(bossOf(person));
}

function line(person) {
  return badgeOf(person) + ":" + payOf(person);
}

function report(person) {
  const parts = [line(person)];
  if (bossOf(person)) parts.push("under " + bossBadgeOf(person));
  return parts.join(" ");
}

function chain(person) {
  const badges = [];
  for (let current = person; current; current = bossOf(current)) {
    badges.push(badgeOf(current));
    if (badges.length > 5) break;
  }
  return badges;
}

function raise(person, amount) {
  person.salary = payOf(person) + amount;
  return payOf(person);
}

function passThrough(person) {
  return person;
}

function throughManyHands(person) {
  const first = passThrough(person);
  const holder = { held: first };
  const list = [holder.held];
  const [second] = list;
  return report(second);
}

const boss = new Employee("B1", 900, null);
const uses = [
  ["report", report],
  ["chain", chain],
  ["raise by 1", person => raise(person, 1)],
  ["through many hands", throughManyHands],
];

const people = [
  ["an employee", () => new Employee("E1", 100, boss)],
  ["a contractor, which shares only badge", () => new Contractor("C1", 5, "agency")],
  ["a contractor as the manager", () => new Employee("E2", 100, new Contractor("C2", 5, "agency"))],
  ["a literal as the manager", () => new Employee("E3", 100, { badge: "L1" })],
  ["a string as the manager", () => new Employee("E4", 100, "somebody")],
  ["a number as the manager", () => new Employee("E5", 100, 7)],
  ["itself as the manager", () => { const person = new Employee("E6", 100, null); person.manager = person; return person; }],
  ["a literal with all three names", () => ({ manager: boss, salary: 100, badge: "L2" })],
  ["a literal with getters that log", () => ({ get badge() { log.push("badge"); return "G1"; }, get salary() { log.push("salary"); return 100; }, set salary(value) { log.push("salary = " + value); }, get manager() { log.push("manager"); return boss; } })],
  ["an employee whose manager is a getter that runs out", () => { let left = 2; return Object.defineProperty(new Employee("E7", 100, null), "manager", { get() { return left-- > 0 ? boss : null; } }); }],
  ["an employee with a string salary", () => new Employee("E8", "100", boss)],
  ["an employee with a bigint salary", () => new Employee("E9", 100n, boss)],
  ["an employee without a salary", () => { const person = new Employee("E10", 100, boss); delete person.salary; return person; }],
  ["a frozen employee", () => Object.freeze(new Employee("E11", 100, boss))],
  ["a proxy around an employee", () => new Proxy(new Employee("E12", 100, boss), { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); } })],
  ["parsed from JSON", () => JSON.parse('{"badge":"J1","salary":100,"manager":{"badge":"J2","salary":1,"manager":null}}')],
  ["null", () => null],
  ["a number", () => 5],
];

function look(phase) {
  for (const [label, make] of people) {
    for (const [name, use] of uses) {
      let text = phase + " | " + label + " | " + name + " -> ";
      try {
        text += show(use(make()));
      } catch (error) {
        text += "threw " + error.constructor.name;
      }
      console.log(text + (log.length ? " | log " + log.splice(0).join(", ") : ""));
    }
  }
}

look("at first");
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Employee("E" + (i % 4), i % 50, boss));
look("after 2000 employees");
console.log("the boss was not touched", show([boss.badge, boss.salary, boss.manager]));
