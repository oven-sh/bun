// Prints which namespaces have an object. One has none where nothing of its body is left without the types: `declare` statements that are not exported, signatures, empty statements, aliases that are not exported, and namespaces of these.
import * as exported from "./exported";
import * as defaults from "./default-export";

function kind(read: () => unknown): string {
  try {
    const value = read();
    if (typeof value === "object" && value !== null) return "object " + JSON.stringify(Object.keys(value));
    return typeof value === "string" ? "string " + value : typeof value;
  } catch (error) {
    return (error as Error).name;
  }
}

namespace Values {
  export const held = 1;
  export type Kind = number;
}

namespace DeclaredConst {
  declare const a: number;
}
console.log(
  "declare const",
  kind(() => DeclaredConst),
  typeof DeclaredConst,
);
namespace DeclaredLet {
  declare let a: number;
}
console.log(
  "declare let",
  kind(() => DeclaredLet),
);
namespace DeclaredVar {
  declare var a: number;
}
console.log(
  "declare var",
  kind(() => DeclaredVar),
);
namespace DeclaredFunction {
  declare function f(): void;
}
console.log(
  "declare function",
  kind(() => DeclaredFunction),
);
namespace DeclaredClass {
  declare class C {}
  declare abstract class D {}
}
console.log(
  "declare class",
  kind(() => DeclaredClass),
);
namespace DeclaredEnum {
  declare enum E {
    X,
  }
}
console.log(
  "declare enum",
  kind(() => DeclaredEnum),
);
namespace DeclaredConstEnum {
  declare const enum E {
    X,
  }
}
// @ts-ignore
console.log(
  "declare const enum",
  // @ts-ignore
  kind(() => DeclaredConstEnum),
);
namespace DeclaredNamespace {
  declare namespace N {
    const x: number;
  }
}
console.log(
  "declare namespace",
  kind(() => DeclaredNamespace),
);
namespace ExportedDeclaredNamespace {
  export declare namespace N {
    const x: number;
    function f(): void;
  }
}
console.log(
  "export declare namespace",
  kind(() => ExportedDeclaredNamespace),
);

namespace ExportedDeclaredConst {
  export declare const a: number;
}
console.log(
  "export declare const",
  kind(() => ExportedDeclaredConst),
);
namespace ExportedDeclaredLet {
  export declare let a: number;
}
console.log(
  "export declare let",
  kind(() => ExportedDeclaredLet),
);
namespace ExportedDeclaredFunction {
  export declare function f(): void;
}
console.log(
  "export declare function",
  kind(() => ExportedDeclaredFunction),
);
namespace ExportedDeclaredClass {
  export declare class C {}
}
console.log(
  "export declare class",
  kind(() => ExportedDeclaredClass),
);
namespace ExportedDeclaredAbstractClass {
  export declare abstract class C {}
}
console.log(
  "export declare abstract class",
  kind(() => ExportedDeclaredAbstractClass),
);
namespace ExportedDeclaredEnum {
  export declare enum E {
    X,
  }
}
console.log(
  "export declare enum",
  kind(() => ExportedDeclaredEnum),
);
namespace ExportedDeclaredConstEnum {
  export declare const enum E {
    X,
  }
}
console.log(
  "export declare const enum",
  // @ts-ignore
  kind(() => ExportedDeclaredConstEnum),
);
namespace ConstEnum {
  const enum E {
    X,
  }
}
console.log(
  "const enum",
  // @ts-ignore
  kind(() => ConstEnum),
);
namespace ExportedConstEnum {
  export const enum E {
    X,
  }
}
console.log(
  "export const enum",
  // @ts-ignore
  kind(() => ExportedConstEnum),
);

namespace Nested {
  namespace Inner {
    declare const x: number;
  }
}
console.log(
  "nested",
  kind(() => Nested),
);
namespace NestedExported {
  export namespace Inner {
    declare const x: number;
  }
}
console.log(
  "nested, exported",
  kind(() => NestedExported),
);
namespace Dotted.Inner {
  declare const x: number;
}
console.log(
  "dotted",
  kind(() => Dotted),
);
namespace NestedMember {
  namespace Inner {
    export declare const x: number;
  }
}
console.log(
  "nested, export declare",
  kind(() => NestedMember),
);
namespace DottedMember.Middle.Inner {
  export declare function f(): void;
}
console.log(
  "dotted, export declare",
  kind(() => DottedMember),
  kind(() => DottedMember.Middle),
  kind(() => DottedMember.Middle.Inner),
);
namespace ReadsInner {
  namespace Inner {
    declare const a: number;
  }
  export const inner = typeof Inner;
}
console.log(
  "read inside",
  kind(() => ReadsInner),
  ReadsInner.inner,
);

class BesideClass {}
namespace BesideClass {
  declare const a: number;
}
console.log(
  "beside a class",
  kind(() => BesideClass),
  Object.keys(BesideClass).length,
);
function besideFunction() {}
namespace besideFunction {
  declare const a: number;
}
console.log(
  "beside a function",
  kind(() => besideFunction),
  Object.keys(besideFunction).length,
);
enum BesideEnum {
  X,
}
namespace BesideEnum {
  declare const a: number;
}
console.log(
  "beside an enum",
  kind(() => BesideEnum),
);
interface BesideInterface {}
namespace BesideInterface {
  declare const a: number;
}
console.log(
  "beside an interface",
  kind(() => BesideInterface),
);
namespace FirstBlock {
  declare const a: number;
}
console.log(
  "between two blocks, the first of declarations",
  kind(() => FirstBlock),
);
namespace FirstBlock {
  export const b = 1;
}
console.log(
  "two blocks, the first of declarations",
  kind(() => FirstBlock),
);
namespace SecondBlock {
  export const b = 1;
}
namespace SecondBlock {
  declare const a: number;
}
console.log(
  "two blocks, the second of declarations",
  kind(() => SecondBlock),
);
namespace EmptyBlock {}
namespace EmptyBlock {
  export const b = 1;
}
namespace EmptyBlock {}
console.log(
  "three blocks, two empty",
  kind(() => EmptyBlock),
);
namespace NoBlock {
  declare const a: number;
}
namespace NoBlock {}
console.log(
  "two blocks, declarations and nothing",
  kind(() => NoBlock),
);

// prettier-ignore
namespace EmptyStatement { export interface I {}; }
console.log(
  "an empty statement",
  kind(() => EmptyStatement),
);
namespace Strict {
  "use strict";
  declare const a: number;
}
console.log(
  "use strict",
  kind(() => Strict),
);
namespace Directive {
  "use other";
}
console.log(
  "another directive",
  kind(() => Directive),
);
namespace Block {
  {
  }
}
console.log(
  "a block",
  kind(() => Block),
);
namespace Alias {
  import held = Values.held;
  declare const a: number;
}
console.log(
  "an alias of a value",
  kind(() => Alias),
);
namespace ExportedAlias {
  export import held = Values.held;
}
console.log(
  "an exported alias of a value",
  kind(() => ExportedAlias),
);
namespace ExportedTypeAlias {
  export import Kind = Values.Kind;
}
console.log(
  "an exported alias of a type",
  kind(() => ExportedTypeAlias),
);
namespace Signature {
  // @ts-ignore
  function f(): void;
  // @ts-ignore
  export function g(): void;
}
console.log(
  "signatures",
  kind(() => Signature),
);
namespace AbstractClass {
  abstract class C {}
}
console.log(
  "an abstract class",
  kind(() => AbstractClass),
);

namespace Map {
  declare const a: number;
}
console.log(
  "named as a global",
  kind(() => Map),
  // @ts-ignore
  new Map([[1, 2]]).size,
);
console.log(
  "read through an alias",
  await import("./alias").then(
    () => "runs",
    error => error.name,
  ),
);

console.log("exported", Object.keys(exported));
console.log("default export", Object.keys(defaults), "default" in defaults);
