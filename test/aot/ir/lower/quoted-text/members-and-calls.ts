// RUN: link
// What fails quotes the text that `bun build` prints there. An outermost expression is printed once, and what it holds is a part of that text:
// the read of `inner` is quoted up to `inner`, the call up to its bracket.
export function probe(holder: any, key: string) {
  return (holder as any)
    .inner!
    .run(key, holder["two words"], holder[key + 1])
    .title;
}
// CHECK: quotedTexts=[{position={{*}} end=12}, {position={{*}} end=16}, {position={{*}} end=59}, {position={{*}} start=22 end=41}, {position={{*}} start=43 end=58}, {position={{*}} end=65}] textOfQuotes="holder.inner.run(key, holder[\x22two words\x22], holder[key + 1]).title"
