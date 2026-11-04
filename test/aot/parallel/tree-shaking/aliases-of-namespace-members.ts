// `import a = N.f` is the only reference to N.f, and `import b = N.Inner.g` to g. An alias of an alias, an exported alias inside another namespace, and an alias of a class used after new.
namespace Tools {
  export function hammer() { return "hammer, " + grip(); }
  function grip() { return "grip"; }
  export namespace Inner {
    export function saw() { return "saw"; }
    export function drill() { return "drill"; }
  }
  export class Box { open() { return "box opened"; } }
  export function unused() { return "unused"; }
}
namespace Shop {
  export import tool = Tools.Inner.drill;
}

import hammer = Tools.hammer;
import saw = Tools.Inner.saw;
import Inner = Tools.Inner;
import again = Inner.saw;
import Box = Tools.Box;

console.log(hammer(), saw(), again === saw, Shop.tool(), new Box().open());
