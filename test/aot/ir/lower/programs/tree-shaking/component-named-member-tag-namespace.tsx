// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.tsx
// <ui.Button /> and <ui.forms.Input /> are the only references to what ui.tsx and forms.tsx export: member tags of a namespace import, one and two levels deep.
/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";
import * as ui from "./ui";

console.log(<ui.Button label="ok" />);
console.log(<ui.forms.Input name="city"></ui.forms.Input>);

// FILE: forms.tsx
/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";

export function Input(props: { name: string }) {
  return <input name={props.name} />;
}

export function Select(props: { name: string }) {
  return <select name={props.name} />;
}

// FILE: h.ts
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

export function h(tag: any, props: any, ...children: any[]): any {
  return typeof tag === "function" ? tag({ ...props, children }) : "<" + tag + " " + JSON.stringify(props) + ">" + children.join("") + "</" + tag + ">";
}

// FILE: ui.tsx
/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";
export * as forms from "./forms";

export function Button(props: { label: string }) {
  return <button>{props.label}</button>;
}

export function Link(props: { to: string }) {
  return <a href={props.to} />;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
