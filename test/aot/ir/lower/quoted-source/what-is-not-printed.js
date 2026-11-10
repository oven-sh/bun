// RUN: link
// A function with statements in it is not printed, so the call that takes it is not quoted. What stands beside it and in it is.
export function probe(holder) {
  holder.each(function (item) {
    return item.title;
  }, holder.last);
  holder.map(item => item.title);
}
// CHECK: quotedSourceText="holder.each(, holder.last)holder.map((item) => item.title)item.title"
