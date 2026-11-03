// Object.assign() creates fields in the order of its sources' keys, whatever order another literal with the same names has.
interface P {
  f: number | string;
  g: number;
}
function scene(): string {
  const o: P = Object.assign({ g: 5 }, { f: 1.5 });
  const other: P = { f: "first", g: 4 };
  let keys: string[] = [];
  for (let i = 0; i < 3; i++) keys = Object.keys(o);
  return [other.f, keys.join(), JSON.stringify(o), JSON.stringify(other)].join(" ");
}
console.log(scene());
