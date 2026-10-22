// `this` when code inside a TypeScript namespace calls a name the namespace exports: the namespace object for a variable, an `export import` and a name of another block, undefined for a function of the same block, which is also not replaced by a store to the property.
namespace Other {
  export function describe(this: unknown) {
    return this === Space ? "Space" : this === Other ? "Other" : typeof this;
  }
}

namespace Space {
  export const constant = Other.describe;
  export let variable = Other.describe;
  export import alias = Other.describe;
  export function declared(this: unknown) {
    return Other.describe.call(this);
  }
  export function callFromSameBlock() {
    return [constant(), variable(), alias(), declared()].join();
  }
}

namespace Space {
  export function callFromOtherBlock() {
    return [constant(), variable(), alias(), declared()].join();
  }
}

console.log(Space.callFromSameBlock());
console.log(Space.callFromOtherBlock());

(Space as any).declared = function (this: unknown) {
  return "replaced " + Other.describe.call(this);
};
console.log(Space.callFromSameBlock());
console.log(Space.callFromOtherBlock());

export {};
