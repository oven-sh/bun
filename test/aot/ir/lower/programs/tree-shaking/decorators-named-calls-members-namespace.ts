// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-LABEL: function {{*}}name="called"
// CHECK-LABEL: function {{*}}name="Target"

// FILE: main.ts
// The only references to these functions stand after an @: a plain name, a call, a member of an object, a member of a namespace import, and a parenthesized expression.
import * as marks from "./marks";
import { log } from "./marks";

function plain(value: Function, context: ClassDecoratorContext): void {
  log.push("plain " + String(context.name));
}

function called(text: string) {
  return (value: Function, context: ClassDecoratorContext): void => {
    log.push("called " + text);
  };
}

function pick(): (value: Function, context: ClassDecoratorContext) => void {
  return (value, context) => {
    log.push("picked");
  };
}

@plain
@called("with text")
@marks.imported
@marks.factory("f")
@(pick())
class Target {}

console.log(log.join("\n"));

// FILE: marks.ts
export const log: string[] = [];

export function imported(value: Function, context: ClassDecoratorContext): void {
  log.push("imported");
}

export function factory(text: string) {
  return (value: Function, context: ClassDecoratorContext): void => {
    log.push("factory " + text);
  };
}

export function unused(): void {
  log.push("unused");
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
