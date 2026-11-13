function make() {
  let total: any = 0;
  return {
    add(turns: number, part: number | string): void { for (let t = 0; t < turns; t++) total += part; },
    get: () => typeof total + " " + total,
  };
}
const m = make();
m.add(Number(JSON.parse("3")), JSON.parse('"x"'));
console.log(m.get());
const k = make(); k.add(Number(JSON.parse("3")), JSON.parse("2")); k.add(Number(JSON.parse("2")), JSON.parse('"y"')); console.log(k.get());
