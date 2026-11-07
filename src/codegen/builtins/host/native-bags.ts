// What the files that describe the objects behind `$cpp(file, symbol)` share.
import * as b from "bun-builtins-table";

// An ordinary object that the host makes for the module that asks, with native functions of its own. It has the listed members and no others.
export const bagOfFunctions = (path: b.BuiltinPath, members: Readonly<Record<string, b.Field>>) => [
  ...b.namespace(path, members, { scope: "Module", listsAllMembers: true }),
  ...b.inherits(path, "Object.prototype"),
];

export const answers = (binding: b.BuiltinPath, answer: b.TableType) =>
  b.static(binding, { getter: answer, capability: "heap", implementation: b.generic });

// A function of which the table says that it is there and is a function. A call hands its operands to native code that nothing describes.
export const undeclaredFunction = b.otherwiseBy(b.generic);

export const undeclaredFunctions = (...names: readonly string[]) =>
  Object.fromEntries(names.map(name => [name, undeclaredFunction]));

// The constructors of classes of which the table says nothing else.
export const undeclaredClasses = (holder: b.BuiltinPath, ...names: readonly string[]) =>
  names.flatMap(name => b.class(`${holder}.${name}`, { hasPrototype: false }));
