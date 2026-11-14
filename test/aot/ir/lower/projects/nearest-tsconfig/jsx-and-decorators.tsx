// RUN: lower

// FILE: main.tsx
import { length } from "./inner/length";
import { marked } from "./legacy/marked";
import { count } from "./standard";
const shown: string = <b>x</b>;
console.log(shown, length, marked, count);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"jsx":"react-jsx","jsxImportSource":"text-jsx","experimentalDecorators":false}}

// FILE: standard.ts
export let count = 0;
function mark(value: Function, context: ClassDecoratorContext) { count = arguments.length; }
@mark
class Marked {}
export const name = Marked.name;

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"jsx":"react-jsx","jsxImportSource":"length-jsx"}}

// FILE: inner/length.tsx
export const length: number = <b>x</b>;

// FILE: inner/wrong.tsx
export const wrong: string = <b>x</b>;

// FILE: legacy/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"experimentalDecorators":true}}

// FILE: legacy/marked.ts
function mark(target: any, key: string) { (target.marked ??= []).push(key); }
export class Marked { @mark two(): number { return 2; } }
export const marked: string = (Marked.prototype as any).marked.join();

// FILE: node_modules/text-jsx/package.json
{"name":"text-jsx","version":"1.0.0"}

// FILE: node_modules/text-jsx/jsx-runtime.ts
export function jsx(tag: string, props: { children?: unknown }): string { return tag + ":" + String(props.children); }
export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = "fragment";
export namespace JSX {
  export type Element = string;
  export interface IntrinsicElements { [name: string]: { children?: unknown } }
}

// FILE: node_modules/text-jsx/jsx-dev-runtime.ts
export * from "./jsx-runtime";

// FILE: node_modules/length-jsx/package.json
{"name":"length-jsx","version":"1.0.0"}

// FILE: node_modules/length-jsx/jsx-runtime.ts
export function jsx(tag: string, props: { children?: unknown }): number { return (tag + ":" + String(props.children)).length; }
export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = "fragment";
export namespace JSX {
  export type Element = number;
  export interface IntrinsicElements { [name: string]: { children?: unknown } }
}

// FILE: node_modules/length-jsx/jsx-dev-runtime.ts
export * from "./jsx-runtime";
