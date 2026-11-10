// @jsxImportSource ./tiny
// The functions of the runtime are imports of the file, under names that nothing binds where the text is evaluated again: the text parses, and the call throws a ReferenceError, as under `bun run`.
function Row<T>(props: { of: T; children?: unknown }) {
  return props.of;
}
const more: Record<string, number> = { b: 2 };
const forms: (() => unknown)[] = [
  () => <div />,
  () => <div id="a">b</div>,
  () => (
    <div key={more.b as number} {...more} n={more.b!}>
      {more.b satisfies number}
      <i />
    </div>
  ),
  () => <div {...more} key="behind" />,
  () => <Row<number> of={1 as number}>{(n: number): number => n}</Row>,
  () => (
    <>
      <p>one</p>
      two
    </>
  ),
];
const again = (text: unknown): any => (0, eval)("(" + text + ")");
for (const form of forms) {
  const made = again(form);
  try {
    console.log(typeof made, made());
  } catch (error: any) {
    console.log(typeof made, error.name, JSON.stringify(form()));
  }
}
// A function that stands among the children has its own text, without its types.
const child = (forms[4]() as any, (<Row<number> of={2}>{(n: number): number => n + 1}</Row>) as any).props.children;
console.log(again(child)(1));
