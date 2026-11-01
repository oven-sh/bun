export namespace Outer {
  export const enum Fixed {
    A = 10,
    Text = "text",
  }
  export const other = 1;
}
export function store(namespace: object) {
  for (const held of Object.values(namespace)) {
    if (typeof held === "object") for (const name of Object.keys(held)) held[name] = "stored";
  }
}
