// A `--define` whose value is one name is the global of that name inside a namespace and an enum that have a member of that name: a member is no variable there.
// Flags: --define NAME=target
declare const NAME: any;
(globalThis as any).target = "the global";
namespace Holder {
  export const target = "the exported member of the namespace";
  export const seen = [NAME, target].join();
}
namespace Holder {
  export const seenBeside = NAME;
}
enum Kind {
  target = "the member of the enum",
  seen = NAME,
}
console.log(Holder.seen, Holder.seenBeside, Kind.seen);

export {};
