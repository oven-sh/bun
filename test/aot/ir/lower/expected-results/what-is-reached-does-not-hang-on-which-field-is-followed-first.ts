// RUN: link
// CHECK: expectedresult {{*}}layouts=[L0, L1, L2, L3, L4]
// CHECK: layout {{*}}fields=[{key="inPear"

// `Apples` and `Pears` have the same names, so they are one record. The file meets `Pears` only where the fields of `Wrap` are looked at, and by then the record may have been
// followed as far as it was known: it is followed again, so a `Pear` is reached whichever of the two fields of `Holder` comes first.
interface Apple {
  inApple: number;
}
interface Pear {
  inPear: number;
}
interface Apples {
  kind: "apples";
  items: Apple[];
}
interface Pears {
  kind: "pears";
  items: Pear[];
}
interface Wrap {
  inner: Pears;
}
interface Holder {
  later: Wrap;
  zlast: Apples;
}
declare function query<T>(text: string): T;

export function load(text: string): number {
  const holder = query<Holder>(text);
  return holder.zlast.items.length;
}
