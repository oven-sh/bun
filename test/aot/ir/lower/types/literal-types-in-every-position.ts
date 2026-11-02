// RUN: link
// CHECK: layout [[holder]] {{*}}name="Holder" {{*}}key="name" declared={type=undefined|null|"a"|"b" site=
// CHECK: layout [[update]] {{*}}name="Update" {{*}}key="destination" declared={type=undefined|null|"argument"|"session" flags=[OmitsNull, OmitsUndefined]}
// CHECK: variable {{*}}name="keys" module=[[entry]] declared={type=undefined|null|absent|Array<undefined|null|"x"|"y"> site=
// CHECK: variable {{*}}name="levels" module=[[entry]] declared={type=undefined|null|absent|Map<undefined|null|"a"|"b", int[1, 2]> site=

// RUN(FUNCTION): lower
// FUNCTION-LABEL: function {{*}}name="takes" {{*}}parameters=[{type=undefined|null|"a"|"b" site={{*}}results=[{type=true site=
// FUNCTION: [[first]]([[name]]: undefined|null|"a"|"b", [[value]]: anything,
// FUNCTION: [[cast]] = Convert [[value]] declared={type=undefined|null|"a"|"b" site=
// FUNCTION-NEXT: PropSet {{*}}, [[cast]] key="name"
// FUNCTION: [[result]] = Convert {{*}}declared={type=true site=
// FUNCTION-NEXT: Return [[result]]

// A literal type is the value itself in every position: field, property, element, map key and value, parameter, result, cast.
interface Point {
  x: number;
  y: number;
}

interface Update {
  destination: "session" | "argument";
}

class Holder {
  name: "a" | "b" = "a";
}

export let keys: (keyof Point)[];
export let levels: Map<"a" | "b", 1 | 2>;

export function takes(name: "a" | "b", value: unknown, update: Update, holder: Holder): true {
  holder.name = value as "a" | "b";
  return true;
}

export function take(value: unknown) {
  return takes("a", "b", value as Update, new Holder());
}
