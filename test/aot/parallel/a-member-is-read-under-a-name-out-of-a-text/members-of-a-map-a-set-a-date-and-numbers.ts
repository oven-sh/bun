const asked: [number, any, unknown[]][] = JSON.parse(
  '[[0,"get",["a"]],[0,"has",["b"]],[0,"size",[]],[0,"set",["c",3]],[0,"delete",["a"]],[0,"keys",[]],[1,"has",[2]],[1,"add",[4]],[1,"size",[]],[1,"union",[]],[2,"getTime",[]],[2,"toISOString",[]],[2,"getUTCFullYear",[]],[2,"toJSON",[]],[3,"toFixed",[1]],[3,"toString",[2]],[3,"toPrecision",[3]],[3,"valueOf",[]],[4,"toString",[]],[4,"valueOf",[]],[5,"toString",[]],[5,"description",[]],[6,"toString",[16]],[0,"absent",[]],[3,"absent",[]]]',
);
for (const [which, name, operands] of asked) {
  const map = new Map([["a", 1]]);
  const set = new Set([1, 2]);
  const date = new Date(0);
  let found: any;
  let receiver: any;
  if (which === 0) ((found = (map as any)[name]), (receiver = map));
  else if (which === 1) ((found = (set as any)[name]), (receiver = set));
  else if (which === 2) ((found = (date as any)[name]), (receiver = date));
  else if (which === 3) ((found = (12.5 as any)[name]), (receiver = 12.5));
  else if (which === 4) ((found = (true as any)[name]), (receiver = true));
  else if (which === 5) ((found = (Symbol.iterator as any)[name]), (receiver = Symbol.iterator));
  else ((found = (255n as any)[name]), (receiver = 255n));
  if (name === "union") {
    console.log(which, name, typeof found, [...found.call(receiver, new Set([9]))].join());
    continue;
  }
  const answer = typeof found === "function" ? found.apply(receiver, operands) : found;
  console.log(
    which,
    name,
    typeof found,
    answer !== null && typeof answer === "object" ? Object.prototype.toString.call(answer) : String(answer),
  );
}
