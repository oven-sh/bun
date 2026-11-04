namespace Box {
  export let size = "member";
  // @ts-ignore
  export function peek(o: object): string { with (o) { return size; } }
}
console.log(Box.peek({ size: "caught" }), Box.peek({}));
