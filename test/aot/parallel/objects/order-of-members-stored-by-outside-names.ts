// Env: NAMES=neverNamedO3,undeclaredO6,lastO4,7
// Env: OTHER=otherO7
interface RecordO1 {
  firstO2?: number;
  neverNamedO3?: string;
  lastO4?: number;
}
class InstanceO5 {
  firstO2?: number;
  lastO4?: number;
}
type Holder = RecordO1 | InstanceO5;
let nameFromOutside = "";
let objectFromOutside: object = {};
function store(holder: Holder, value: unknown): void {
  (holder as Record<string, unknown>)[nameFromOutside] = value;
}
function show(label: string, holder: Holder): void {
  const inLoop: string[] = [];
  for (const key in holder) inLoop.push(key);
  console.log(
    label,
    Object.keys(holder).join(),
    inLoop.join(),
    JSON.stringify(holder),
    JSON.stringify({ ...holder }),
    JSON.stringify(structuredClone({ ...holder })),
    Object.entries(holder).join(";"),
    Reflect.ownKeys(holder).join(),
    JSON.stringify(Object.assign({}, holder)),
    nameFromOutside in holder,
    (holder as Record<string, unknown>)[nameFromOutside],
  );
}
function run(kind: string, make: () => Holder): void {
  const inFront = make();
  store(inFront, "x");
  inFront.firstO2 = 1;
  inFront.lastO4 = 2;
  show(kind + " in front", inFront);

  const between = make();
  between.firstO2 = 1;
  store(between, "x");
  between.lastO4 = 2;
  show(kind + " between", between);

  const behind = make();
  behind.firstO2 = 1;
  behind.lastO4 = 2;
  store(behind, "x");
  show(kind + " behind", behind);

  const again = make();
  again.firstO2 = 1;
  store(again, "x");
  again.lastO4 = 2;
  delete (again as Record<string, unknown>)[nameFromOutside];
  show(kind + " deleted", again);
  store(again, "y");
  show(kind + " stored again", again);

  const assigned = make();
  assigned.firstO2 = 1;
  Object.assign(assigned, objectFromOutside);
  assigned.lastO4 = 2;
  show(kind + " assigned", assigned);

  const spread: Holder = { firstO2: 1, ...objectFromOutside, lastO4: 2 };
  show(kind + " spread", spread);
}
for (nameFromOutside of process.env.NAMES!.split(",")) {
  objectFromOutside = JSON.parse(JSON.stringify({ [nameFromOutside]: "z", [process.env.OTHER!]: 1 }));
  run("record", () => ({}));
  run("instance", () => new InstanceO5());
  const literal: RecordO1 = { firstO2: 1, lastO4: 2 };
  store(literal, "x");
  show("literal", literal);
}
