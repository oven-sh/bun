export type Row = { id: number };
export type Held<T extends object> = Wrapper<T> | (Wrapper<T> & { readonly tag: T });
export class Wrapper<T extends object> {
  constructor(public value: T) {}
  put<Inner extends T>(next: Inner | Held<Inner>): void { this.value = next instanceof Wrapper ? next.value : next; }
  putTwice<Inner extends T>(first: Inner | Held<Inner>, second: Inner | Held<Inner>): void { this.put(first); this.put(second); }
  take<Inner extends T>(from: Held<Inner>): Inner { const taken = from.value; this.value = taken; return taken; }
  wrap<Inner extends T>(next: Inner): Wrapper<Inner> { return new Wrapper<Inner>(next); }
  pick<Inner extends T>(first: Held<Inner>, second: Held<Inner>, useFirst: boolean): Held<Inner> { return useFirst ? first : second; }
  same<Inner extends T>(other: Inner | Held<Inner>): boolean { return (other instanceof Wrapper ? other.value : other) === this.value; }
}
export function make(id: number): Wrapper<Row> { return new Wrapper<Row>({ id }); }
export function idOf(wrapper: Wrapper<Row>): number { return wrapper.value.id; }
