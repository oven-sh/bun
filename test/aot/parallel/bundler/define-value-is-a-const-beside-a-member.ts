// A `--define` whose value is one name reads the `const` of the file inside a namespace and an enum that have a member of that name: a member is no variable there.
// Flags: --define NAME=target
declare const NAME: any;
(globalThis as any).target = "the global";
const target = "the const of the file";
namespace Holder {
  export const target = "the exported member of the namespace";
  export const seen = [NAME, target].join();
}
enum Kind {
  target = "the member of the enum",
  seen = NAME,
}
console.log(Holder.seen, "|", Kind.seen);
export {};
