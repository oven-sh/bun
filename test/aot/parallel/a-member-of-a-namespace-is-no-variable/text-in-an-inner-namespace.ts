namespace Out {
  const x = "local of Out";
  export namespace In { export const x = "member of In"; export const seen = eval("x"); }
}
console.log(Out.In.seen, Out.In.x);
