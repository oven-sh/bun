// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 6
// CHECK-LABEL: function {{*}}name="Derived"

// FILE: main.tsx
// "sideEffects": false, and each import of the package has one use that is no plain identifier: a JSX tag, a member tag, the factory of a pragma, a decorator, a shorthand property, an export clause and a heritage clause. `bun run` also prints "unused.js is evaluated". `bun build --compile` leaves that file out, and --aot follows it.
/* @jsxRuntime classic */
/* @jsx h */
import { h, Tag, mark, shorthand, reexported, Base } from "odd";
import * as odd from "odd";
import * as self from "./main";

export { reexported };

@mark
class Derived extends Base {}

console.log(<Tag />, <odd.MemberTag />);
console.log({ shorthand }.shorthand(), self.reexported(), new Derived().method(), (Derived as any).marked);

// FILE: node_modules/odd/base.js
export class Base { method() { return "method of Base"; } }

// FILE: node_modules/odd/functions.js
export function shorthand() { return "shorthand"; }
export function reexported() { return "exported again"; }

// FILE: node_modules/odd/h.js
export function h(tag) { return typeof tag === "function" ? tag() : tag; }

// FILE: node_modules/odd/index.d.ts
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
export function h(tag: any, props: any, ...children: any[]): any;
export function Tag(): any;
export function MemberTag(): any;
export function mark(value: Function, context: ClassDecoratorContext): void;
export function shorthand(): string;
export function reexported(): string;
export class Base { method(): string }

// FILE: node_modules/odd/index.js
export { h } from "./h.js";
export { Tag, MemberTag } from "./tags.js";
export { mark } from "./mark.js";
export { shorthand, reexported } from "./functions.js";
export { Base } from "./base.js";
export { unused } from "./unused.js";

// FILE: node_modules/odd/mark.js
export function mark(value) { value.marked = "marked"; }

// FILE: node_modules/odd/package.json
{ "name": "odd", "version": "1.0.0", "type": "module", "main": "index.js", "types": "index.d.ts", "sideEffects": false }

// FILE: node_modules/odd/tags.js
export function Tag() { return "tag"; }
export function MemberTag() { return "member tag"; }

// FILE: node_modules/odd/unused.js
console.log("unused.js is evaluated");
export function unused() { return "unused"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
