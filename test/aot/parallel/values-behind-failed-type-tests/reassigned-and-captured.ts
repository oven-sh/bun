function make(value: number | undefined) {
  if (value === undefined) value = 4;
  const read = () => value;
  const write = (next: any) => {
    value = next;
  };
  return { read, write };
}
const first = make(undefined);
const second = make(2.5);
console.log(first.read(), second.read());
first.write(undefined);
second.write("text");
console.log(first.read(), second.read(), make(0).read(), make(NaN).read());
