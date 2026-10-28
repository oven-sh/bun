// A statement that ends in a member of a built-in object evaluates what stands in front of the member, whatever casts stand around them.
function said(): number {
  console.log("called");
  return 1;
}
(said(), Object.keys) as unknown;
(said(), Object.keys) as typeof Object.keys;
<unknown>(said(), Object.keys);
(said(), Object.keys)!;
(said(), Object.keys) satisfies unknown;
(said(), Object.keys as unknown);
(said() as unknown, Object.keys);
((said(), Object) as typeof Object).keys;
(said(), Object)!.keys;
((said(), Object) satisfies object).keys;
((said(), Math) as any).PI;
void ((said(), Symbol.iterator) as symbol);
for (let turn = 0; turn < 2; turn++, Math.PI as number) console.log("turn", turn);
for (let turn = 0; turn < 2; (turn++, Object.keys)!) console.log("turn", turn);

const anything: any = {};
function ending(f: () => void): void {
  try {
    f();
    console.log("completes");
  } catch (error) {
    console.log("throws", (error as Error).constructor.name);
  }
}
ending(() => {
  (anything.shout(), Object.keys) as unknown;
});
ending(() => {
  (anything.shout(), Object)!.keys;
});
console.log("end");
