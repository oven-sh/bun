// `OnLink = Split["First"].A + 30`: TypeScript computes no value for a path with a link in brackets, so an executable reads `Second.OnLink` from the object of the enum, as what TypeScript's compiler emits does. `bun run` puts 31 in place of every read.
function attempt(read: () => unknown) {
  try {
    return read();
  } catch (error) {
    return (error as Error).name;
  }
}

console.log(
  "ahead of the enums",
  attempt(() => Split.Second.OnLink),
  attempt(() => Split["Second"].OnLinkAndMember),
  attempt(() => Late.Inner.OnItsOwnPath),
);

namespace Split {
  export enum First {
    A = 1,
  }
}
namespace Split {
  export enum Second {
    OnLink = Split["First"].A + 30,
    OnLinkAndMember = Split["First"]["A"] + 40,
  }
}
namespace Late {
  export enum Inner {
    A = 1,
    OnItsOwnPath = Late["Inner"].A + 1,
  }
}

console.log("the objects", JSON.stringify(Split.Second), JSON.stringify(Late.Inner));
console.log(
  "read",
  Split.Second.OnLink,
  Split.Second.OnLinkAndMember,
  Split["Second"].OnLink,
  Split.Second["OnLink"],
  Late.Inner.OnItsOwnPath,
);

const second = Split.Second as Record<string, unknown>;
const inner = Late.Inner as Record<string, unknown>;
second.OnLink = "stored";
second.OnLinkAndMember = "stored";
inner.OnItsOwnPath = "stored";
console.log(
  "stored",
  Split.Second.OnLink,
  Split.Second.OnLinkAndMember,
  Split["Second"].OnLink,
  Split.Second["OnLink"],
  Late.Inner.OnItsOwnPath,
);

delete second.OnLink;
delete second.OnLinkAndMember;
delete inner.OnItsOwnPath;
console.log(
  "members deleted",
  Split.Second.OnLink,
  Split.Second.OnLinkAndMember,
  Split["Second"].OnLink,
  Split.Second["OnLink"],
  Late.Inner.OnItsOwnPath,
);

delete (Split as Record<string, unknown>).Second;
delete (Late as Record<string, unknown>).Inner;
console.log(
  "enums deleted",
  attempt(() => Split.Second.OnLink),
  attempt(() => Split.Second.OnLinkAndMember),
  attempt(() => Split["Second"].OnLink),
  attempt(() => Split.Second["OnLink"]),
  attempt(() => Late.Inner.OnItsOwnPath),
);
/* Output:
ahead of the enums TypeError TypeError TypeError
the objects {"31":"OnLink","41":"OnLinkAndMember","OnLink":31,"OnLinkAndMember":41} {"1":"A","2":"OnItsOwnPath","A":1,"OnItsOwnPath":2}
read 31 41 31 31 2
stored stored stored stored stored stored
members deleted undefined undefined undefined undefined undefined
enums deleted TypeError TypeError TypeError TypeError TypeError
*/
