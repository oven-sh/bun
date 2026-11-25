// A decorated class takes its name from the declaration that Bun prints for it, also where the target is a member of a namespace.
const mark = (value: any, context: any) => value;
namespace Shelf {
  export let made: any;
  [(made as any) = @mark class {}] = [] as any[];
}
console.log(JSON.stringify(Shelf.made.name));
