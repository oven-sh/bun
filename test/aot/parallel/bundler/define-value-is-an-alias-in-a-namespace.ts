// Inside a namespace, `export import name = a.b` makes a member of the namespace, and a `--define` whose value is that name reads the global. An alias that is not exported is a variable of the namespace, and the value reads it.
// Flags: --define NAME=target --define OTHER=local
declare const NAME: string, OTHER: string;
(globalThis as any).target = "the global";
(globalThis as any).local = "the global";
namespace Source {
  export const value = "the value behind the alias";
}
namespace Holder {
  export import target = Source.value;
  import local = Source.value;
  export const seen = [NAME, OTHER, target, local].join(", ");
}
console.log(Holder.seen);

export {};
