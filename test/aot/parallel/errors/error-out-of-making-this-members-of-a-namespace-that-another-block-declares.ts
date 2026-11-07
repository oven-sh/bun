// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first position that the constructor records. Here: constructors that begin with a member of a namespace that another block of the namespace declares. Bun's transpiler prints such a name as a member, `Held.holder`: the name of the namespace is recorded first, and a token behind the member is mapped where it starts a line. An import of another module is printed as a name, and a token behind it has no mapping.
import { basename } from "node:path";
function f(..._: any[]): any {
  return 0;
}
const key = () => "name";
namespace Held {
  export const holder: any = { name: 1, list: [] };
  export const tag: any = () => 1;
}
function column(A: any) {
  const given = { __proto__: A.prototype };
  const B: any = new Proxy(A, { get: (t: any, k: any) => (k === "prototype" ? given : t[k]) });
  try {
    new B();
  } catch (error: any) {
    console.log(error.stack.split("\n").find((line: string) => line.includes("new A")).replace(/.*[\\/]/, ""));
  }
}
// prettier-ignore
namespace Held {
  column(class A { constructor() { holder
    .name; } });
  column(class A { constructor() { holder
    [key()]; } });
  column(class A { constructor() { tag
    `text`; } });
  column(class A { constructor() { holder.name; } });
  column(class A { constructor() { [holder]; } });
  column(class A { constructor() { [holder
    ]; } });
  column(class A { constructor() { f(...holder
    .list); } });
  column(class A { constructor() { new holder
    .name; } });
  column(class A { constructor() { holder
    (1); } });
  column(class A { constructor() { (() => tag
    `text`)(); } });
}
// prettier-ignore
{
  column(class A { constructor() { (basename as any)
    .name; } });
  column(class A { constructor() { (basename as any)
    [key()]; } });
  column(class A { constructor() { (() => (basename as any)
    `text`)(); } });
}
