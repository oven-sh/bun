// Each field is declared as a number or a boolean that may be undefined, and is born undefined. Nothing ever stores a number or a boolean into it. A null reaches it past its type.
interface Reading {
  id: number;
  level: number | undefined;
}
interface Switch {
  on: boolean | undefined;
  id: number;
}
class Gauge {
  id = 3;
  level: number | undefined = undefined;
}
function clear(target: { level?: number | null | undefined }): void {
  target.level = null;
}
for (let turn = 0; turn < 3; turn++) {
  const assigned: Reading = { id: 1, level: undefined };
  if (turn) Object.assign(assigned, { level: null });
  console.log(JSON.stringify(assigned), JSON.stringify([assigned]), JSON.stringify({ assigned }), assigned.level);

  const set: Switch = { on: undefined, id: 2 };
  if (turn) Reflect.set(set, "on", null);
  console.log(JSON.stringify(set), JSON.stringify({ ...set }), set.on);

  const gauge = new Gauge();
  if (turn) clear(gauge);
  console.log(JSON.stringify(gauge), JSON.stringify(gauge, null, 1).length, gauge.level);
}
