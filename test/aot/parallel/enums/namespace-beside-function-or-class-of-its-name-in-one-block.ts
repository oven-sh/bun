// One block of a namespace exports a function, or a class, and a namespace of the same name. Plain Bun reads an enum of that namespace from the object, in the block, from another block and by the whole path: its transpiler keeps no record of the members (#47001). A part of the namespace in a later block is followed again. The enum objects change afterwards, so a read that has the value in place shows it.
function change(object: unknown) {
  const held = object as Record<string, unknown>;
  for (const name of Object.keys(held)) {
    if (typeof held[name] !== "object" && typeof held[name] !== "function") held[name] = "changed";
  }
}

namespace M {
  export function F() {}
  export namespace F {
    export enum E {
      A = 1,
    }
  }
  export class C {}
  export namespace C {
    export enum E {
      A = 5,
    }
  }
  export function readInBlock() {
    return [F.E.A, C.E.A];
  }
}
namespace M {
  export enum FromFunction {
    P = F.E.A,
    R,
  }
  export enum FromClass {
    P = C.E.A,
    R,
  }
  export function read() {
    return [F.E.A, C.E.A];
  }
}
const readByPath = () => [M.F.E.A, M.C.E.A];

namespace Again {
  export function F() {}
  export namespace F {
    export enum E {
      A = 3,
    }
  }
}
namespace Again {
  export namespace F {
    export enum G {
      B = 4,
    }
  }
  export function readInBlock() {
    return [F.E.A, F.G.B];
  }
}
namespace Again {
  export enum FromFirst {
    P = F.E.A,
    R,
  }
  export enum FromLater {
    P = F.G.B,
    R,
  }
  export function read() {
    return [F.E.A, F.G.B];
  }
}
const readAgainByPath = () => [Again.F.E.A, Again.F.G.B];

namespace Below {
  export namespace N {
    export function F() {}
    export namespace F {
      export enum E {
        A = 6,
      }
    }
  }
}
namespace Below {
  export function read() {
    return N.F.E.A;
  }
}

console.log("enums", JSON.stringify([M.FromFunction, M.FromClass, Again.FromFirst, Again.FromLater]));
const readAll = () => [
  M.readInBlock(),
  M.read(),
  readByPath(),
  Again.readInBlock(),
  Again.read(),
  readAgainByPath(),
  Below.read(),
];
console.log("before", JSON.stringify(readAll()));
for (const object of [M.F.E, M.C.E, Again.F.E, Again.F.G, Below.N.F.E]) change(object);
console.log("after", JSON.stringify(readAll()));
