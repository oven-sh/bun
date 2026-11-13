// RUN: link
// `bun build` prints a name in brackets, a template without substitutions and a constant in front of a comma as they are written: only a build that minifies syntax rewrites them.
// In every build a function without statements is printed, and the operator behind an object literal opens the bracket where the body of an arrow begins.
export function probe(holder) {
  holder["each"](`plain`, (1, holder.last()), function (item) {}, () => ({}) instanceof holder);
  holder[`each`]((0, holder.last)());
}
// CHECK: quotedSourceText="holder[\x22each\x22](`plain`, (1, holder.last()), function(item) {}, () => ({} instanceof holder))holder[`each`]((0, holder.last)())"
