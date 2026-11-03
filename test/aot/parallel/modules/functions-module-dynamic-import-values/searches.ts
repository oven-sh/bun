let notes = 0;
function note(value: unknown): void {
  if (notes++ < 80) console.log("noted", value instanceof Date ? "a date" : value);
}
interface Lists {
  readonly list: number[];
}
type OnlyList = Pick<Lists, "list">;
{
  function searchTwice(text: string, other: OnlyList): void {
    try {
      let held: string = "";
      for (let turn = 0; turn < 2; turn++) {
        note(held.indexOf("a"));
        if (turn === 0) held = text;
      }
    } catch (error) {
      console.error(String((error as any)?.["message"]).slice(0, 12));
    }
  }
  searchTwice("" as any, true as any);
  searchTwice({} as any, {} as any);
  searchTwice((() => 1) as any, (() => 1) as any);
  searchTwice(true as any, "" as any);
}
{
  function catchNothing() {
    try {
    } catch (error) {}
  }
  function declareClass(list: string[], other: string | null): void {
    for (let turn = 0; turn < 3; turn++) {}
    class Empty {}
  }
  try {
    declareClass(2147483648 as any, new Number(3) as any);
  } catch (error) {
    note("threw");
    console.error(String((error as any)?.["message"]).slice(0, 12));
  }
}
{
  function makeChain(...starts: number[]) {
    try {
      class Chain<T> {
        with<U>(value: U): Chain<T | U> {
          const next: Chain<T | U> = this;
          return next;
        }
      }
      const narrow = new Chain<number[]>();
    } catch (error) {
      note((error as any)?.name);
    }
  }
  for (let turn = 0; turn < 3; turn++) for (let again = 0; again < 2; again++) makeChain(0);
}
