const swap = (made: any) => class extends made {};
const seen: unknown[] = [];
const note = (value: unknown) => { seen.push(value); return () => {}; };
export @swap class Kit {
  @note(Kit) field = 1;
  static [(seen.push(Kit), "key")] = 2;
}
console.log(seen.map((value) => typeof value).join(), (Kit as any).key);
