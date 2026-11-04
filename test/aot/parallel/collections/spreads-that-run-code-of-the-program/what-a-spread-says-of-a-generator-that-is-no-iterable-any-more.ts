// A generator that was changed is spread by the operation of the run time, which words its errors as a spread does.
function* upTo(limit: number): Generator<number> { for (let i = 0; i < limit; i++) yield i; }
const deeds: ((generator: any) => void)[] = [
  generator => { generator[Symbol.iterator] = undefined; },
  generator => { generator[Symbol.iterator] = 5; },
  generator => { generator[Symbol.iterator] = () => 5; },
  generator => { generator[Symbol.iterator] = () => ({}); },
  generator => { generator[Symbol.iterator] = () => ({ next: () => 5 }); },
  generator => { generator.next = 5; },
  generator => { generator.next = () => undefined; },
  generator => { Object.setPrototypeOf(generator, null); },
  generator => { Object.setPrototypeOf(generator, {}); },
];
for (const deed of deeds) {
  const generator = upTo(2);
  deed(generator);
  try { console.log([...generator].join()); } catch (error) { console.log(String(error)); }
  const other = upTo(2);
  deed(other);
  try { console.log(Math.max(...other)); } catch (error) { console.log(String(error)); }
}
