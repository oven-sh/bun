function setup() {
  let count = 0;
  const list: number[] = [];
  return {
    add(n: number) {
      count += n;
      list.push(n);
      return count;
    },
    all: () => list.join() + "/" + count,
  };
}
const one = setup();
let text = "";
for (let i = 0; i < 3; i++) text += one.add(i) + " ";
const makers = [setup, setup].map(f => f());
for (const m of makers) text += m.add(10) + m.all() + " ";
console.log(text, one.all());
const again = Array.from({ length: 2 }, setup as any) as any[];
again[0].add(5);
console.log(again.map(m => m.all()).join("|"), one.all());
