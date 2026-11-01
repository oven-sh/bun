// Flags: --aot-verify-each-pass
// One arm of a switch stores a list that the program writes out. The build keeps such a list as data, and making an object of data may throw where the literal did not.
type Props = { a?: number; b?: string; c?: boolean; d?: string[]; e?: number; f?: string };
function set(props: Props, which: number, index: number) {
  switch (which) {
    case 0: props.a = index; break;
    case 1: props.b = "s" + index; break;
    case 2: props.c = true; break;
    case 3: props.d = ["x"]; break;
    case 4: props.e = index + 1; break;
    case 5: props.f = "t"; break;
  }
}
function make(seed: number): Props {
  const props: Props = {};
  for (let index = 0; index < 9 + seed % 6; ++index) set(props, (seed * 7 + index) % 6, index);
  return props;
}
let total = 0;
for (let seed = 0; seed < 100; ++seed) total += Object.keys(make(seed)).length;
console.log(total);
export {};
