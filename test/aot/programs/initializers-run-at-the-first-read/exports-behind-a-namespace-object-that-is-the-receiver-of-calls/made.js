function make(name, build) {
  function made() {
    return build();
  }
  Object.defineProperty(made, "name", { value: name });
  Object.defineProperty(made, "kind", { value: "made" });
  return made;
}

export const direct = make("direct", () => 1);
export const looked = make("looked", () => 2);
export const tested = make("tested", () => 3);
export const besideAnother = make("besideAnother", () => 4);
export const throughSelf = make("throughSelf", () => 5);
export const late = make("late", () => 6);
export const never = make("never", () => 7);

export function self() {
  return this;
}
export function look() {
  return this.looked;
}
export function test() {
  return "tested" in this;
}
export function missing() {
  return "absent" in this;
}
