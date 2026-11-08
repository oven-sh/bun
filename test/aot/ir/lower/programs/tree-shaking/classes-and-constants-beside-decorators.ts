// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="register"
// CHECK-LABEL: function {{*}}name="tagged"
// CHECK-LABEL: function {{*}}name="Second"
// CHECK-LABEL: function {{*}}name="method"

// FILE: main.ts
// Standard decorators. The decorators are constants; the decorated classes are named nowhere; other classes and constants of the file are named only by a decorator's argument, by a decorated field's initializer, or not at all.
const log: string[] = [];
const register = (value: Function, context: ClassDecoratorContext) => { log.push("registered " + String(context.name)); };
const tagged = (tag: { text: string }) => (value: Function, context: ClassDecoratorContext) => { log.push("tagged " + tag.text); };
const bound = (value: Function, context: ClassMethodDecoratorContext) => { log.push("method " + String(context.name)); };
const watched = (value: undefined, context: ClassFieldDecoratorContext) => (initial: any) => { log.push("field " + String(context.name) + " = " + initial); return initial; };
const argument = { text: "an argument of a decorator" };
const initial = "the initializer of a decorated field";
const unusedDecorator = (value: Function) => {};
const unusedConstant = { a: 1 };
class Plain { name() { return "plain"; } }
class UnusedPlain {}

@register
class First {}

@tagged(argument)
class Second { @bound method() {} }

class Third { @watched field = initial; made = new Plain().name(); }

console.log(new Third().made);
console.log(log.join("\n"));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
