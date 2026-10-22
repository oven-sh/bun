// A part that is held twice is changed by an accessor between the two visits of a validation that remembers what it has found: whatever validate<T> returns must still fit T when it is written and parsed again by T. Each place is read when the validation comes to it, so the second place holds the part as the accessor left it: 84 of the 720 values still fit (Kinds 48, Deep 0, Lists 36).
import { validate } from "bun:bundle";
type Kinds = { below: Kinds | null; also?: Kinds | null; k: number } | { below: Kinds | null; also?: Kinds | null; k: string };
type Deep = { below: Deep | null; also?: Deep | null; x: { k: 1 } } | { below: Deep | null; also?: Deep | null; x: { k: 2 } };
type Lists = { items: Lists[]; k: number[] } | { items: Lists[]; k: string[] };

const misfits: (() => unknown)[] = [() => ({}), () => [], () => null, () => true, () => undefined, () => "text", () => 7, () => ({ k: 3 }), () => [1, "a"], () => Symbol("s")];
let values = 0;
let refused = 0;
let thrown = 0;
let unfit = 0;

function judge<T>(validate: (value: unknown) => T, parse: (text: string) => T, make: () => unknown): void {
  let result: T;
  try {
    result = validate(make());
  } catch (error: any) {
    if (error?.name === "TypeError" && error.issues?.length > 0) refused++;
    else thrown++;
    return;
  }
  values++;
  try {
    parse(JSON.stringify(result));
  } catch {
    unfit++;
  }
}

for (const misfit of misfits) {
  for (const levels of [0, 1, 3, 8]) {
    for (const where of [0, 1, 2, 3, 4, 5]) {
      const wrap = (value: any, member: string, filler: () => any): any => {
        for (let level = 0; level < levels; level++) value = { ...filler(), [member]: value };
        return value;
      };
      judge(value => validate<Kinds>(value), text => JSON.parse<Kinds>(text), () => {
        const shared: any = { below: null, k: 1 };
        const spoil = () => { shared.k = misfit(); return where % 2 ? "s" : 2; };
        const inner = wrap(shared, "below", () => ({ k: 1 }));
        const again = wrap(shared, "below", () => ({ k: "s" }));
        if (where < 2) return { below: inner, get k() { return spoil(); }, also: again };
        if (where < 4) return { get k() { return spoil(); }, below: inner, also: again };
        return { below: inner, also: { below: again, get k() { return spoil(); } }, k: 1 };
      });
      judge(value => validate<Deep>(value), text => JSON.parse<Deep>(text), () => {
        const shared: any = { below: null, x: { k: 1 } };
        const spoil = () => { if (where % 2) shared.x = misfit(); else shared.x.k = misfit(); return { k: 2 }; };
        const inner = wrap(shared, "below", () => ({ x: { k: 1 } }));
        const again = wrap(shared, "below", () => ({ x: { k: 2 } }));
        if (where < 2) return { below: inner, get x() { return spoil(); }, also: again };
        if (where < 4) return { get x() { return spoil(); }, below: inner, also: again };
        return { below: inner, also: { below: again, get x() { return spoil(); } }, x: { k: 1 } };
      });
      judge(value => validate<Lists>(value), text => JSON.parse<Lists>(text), () => {
        const shared: any = { items: [], k: [1] };
        const spoil = () => { if (where % 2) shared.k = misfit(); else shared.k[0] = misfit(); return ["s"]; };
        let inner: any = shared;
        for (let level = 0; level < levels; level++) inner = { items: [inner, shared], k: [level] };
        if (where < 2) return { items: [inner, { items: [], get k() { return spoil(); } }, shared, inner], k: [1] };
        if (where < 4) return { get k() { return spoil(); }, items: [inner, shared] };
        return { items: [shared, inner, shared], get k() { return spoil(); } };
      });
    }
  }
}
console.log(values + " values, " + refused + " refused, " + thrown + " thrown; values that do not fit their type: " + unfit);
