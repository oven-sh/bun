namespace Box {
  export let who = function (this: unknown) { return this === Box ? "box" : typeof this; };
  // @ts-ignore
  export function ask(o: object): string { with (o) { return who(); } }
}
console.log(Box.ask({ who() { return "caught"; } }), Box.ask({}));
