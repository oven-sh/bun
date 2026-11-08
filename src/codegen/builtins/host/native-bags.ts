// What the files that describe the objects behind `$cpp(file, symbol)` share.
import * as b from "bun-builtins-table";

// An ordinary object that the host makes for the module that asks, with native functions of its own. It has the listed members and no others.
export const bagOfFunctions = (path: b.BuiltinPath, members: Readonly<Record<string, b.Field>>) => [
  ...b.namespace(path, members, { scope: "Module", listsAllMembers: true }),
  ...b.inherits(path, "Object.prototype"),
];

// A call of the object itself throws: it is a bag, a constructor's holder or a value, not a function.
export const isNoFunction = {
  returns: b.never,
  capability: "heap",
  throws: true,
  implementation: b.generic,
} satisfies b.FunctionField;

// What `$cpp(file, symbol)` answers. Without the call row the engine writes one that says a call may answer anything, and
// a module that only reads the binding is then taken to hold objects of every class.
export const answers = (binding: b.BuiltinPath, answer: b.TableType) =>
  b.static(binding, { getter: answer, capability: "heap", implementation: b.generic, call: isNoFunction });

// A function of which the table says that it is there and is a function. A call hands its operands to native code that nothing describes.
export const undeclaredFunction = b.otherwiseBy(b.generic);

export const undeclaredFunctions = (...names: readonly string[]) =>
  Object.fromEntries(names.map(name => [name, undeclaredFunction]));

// The constructors of classes of which the table says nothing else.
export const undeclaredClasses = (holder: b.BuiltinPath, ...names: readonly string[]) =>
  names.flatMap(name => b.class(`${holder}.${name}`, { hasPrototype: false }));
