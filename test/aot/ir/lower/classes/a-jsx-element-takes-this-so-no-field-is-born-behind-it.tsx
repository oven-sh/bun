// RUN: lower
// Under "jsx": "react-jsxdev" the sixth argument of jsxDEV is `this`, and no `this` is written: the run time sees the object. So a JSX element counts as naming the object: the fields of Page are laid by its
// initializer in front of everything, as written; those of Plain, whose constructor holds no element, are defined with what it stores.
// CHECK-LABEL: function {{*}}name="Page" {{*}}kind=BaseConstructor
// CHECK: [[this]] = Convert {{*}} declared={type=L{{*}}}
// CHECK-NEXT: = CallDirect [[this]] function=
// CHECK: = Call{{*}}
// CHECK: PropSet [[this]], {{*}}key="view"
// CHECK: PropSet [[this]], {{*}}key="title"
// CHECK-LABEL: function {{*}}name="Plain" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropDefine {{*}}key="title"
// CHECK: PropDefine {{*}}key="size"

// FILE: main.tsx
export class Page { title: string; view: unknown; constructor(title: string) { this.view = <p/>; this.title = title; } }
export class Plain { title: string; size: number; constructor(title: string) { const size = title.length; this.size = size; this.title = title; } }

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"jsx":"react-jsxdev","jsxImportSource":"keys-jsx"}}

// FILE: node_modules/keys-jsx/package.json
{"name":"keys-jsx","version":"1.0.0"}

// FILE: node_modules/keys-jsx/jsx-dev-runtime.ts
export function jsxDEV(tag: string, props: unknown, key: unknown, isStatic: boolean, source: unknown, self: object): string { return Object.keys(self).join(); }
export const Fragment = "fragment";
export namespace JSX {
  export type Element = string;
  export interface IntrinsicElements { [name: string]: {} }
}
