#!/usr/bin/env python3
"""own-names-of-error-classes.py <folder>: Where an error is asked for a name of its own, or for all of them, the engine makes
its stack, and the program's Error.prepareStackTrace runs for that in the middle of the call. Base classes (the error
classes, chains of them, bases that are picked at run time, mixins, other built-in classes, Error.captureStackTrace on what
is no error) x operations x the way the instance is typed. The hook counts its calls, and the function reads the count
before and behind one operation on the instance.
"""
import os, sys

out = sys.argv[1]

# name: (declarations, expression that makes an instance)
bases = {
    "error": ("class Failure extends Error { code = 7; BODY }", 'new Failure("f")'),
    "typeerror": ("class Failure extends TypeError { code = 7; BODY }", 'new Failure("f")'),
    "aggregate": ("class Failure extends AggregateError { code = 7; constructor(m: string) { super([], m); } BODY }", 'new Failure("f")'),
    "suppressed": ("class Failure extends SuppressedError { code = 7; constructor(m: string) { super(1, 2, m); } BODY }", 'new Failure("f")'),
    "dom": ("class Failure extends DOMException { code2 = 7; BODY }", 'new Failure("f")'),
    "wasm": ("class Failure extends WebAssembly.RuntimeError { code = 7; BODY }", 'new Failure("f")'),
    "chain": ("class Middle extends Error { level = 1; }\nclass Failure extends Middle { code = 7; BODY }", 'new Failure("f")'),
    "chainrange": ("class Middle extends RangeError { level = 1; }\nclass Failure extends Middle { code = 7; BODY }", 'new Failure("f")'),
    "picked": ("function pick(): typeof Error { return calls === 0 ? Error : TypeError; }\nclass Failure extends pick() { code = 7; BODY }", 'new Failure("f")'),
    "pickedlist": ("const choices: ErrorConstructor[] = [Error, TypeError];\nconst Base = choices[calls];\nclass Failure extends Base { code = 7; BODY }", 'new Failure("f")'),
    "pickedmixed": ("const choices: any[] = [Error, Map];\nconst Base = choices[calls];\nclass Failure extends Base { code = 7; BODY }", 'new Failure("f")'),
    "pickedclasses": ("class One extends Error { one = 1; }\nclass Two extends Error { two = 2; }\nconst choices = [One, Two];\nclass Failure extends choices[calls] { code = 7; BODY }", 'new Failure("f")'),
    "mixin": ("function mixin<T extends new (...list: any[]) => object>(Base: T) { return class extends Base { code = 7; BODY }; }\nconst Failure = mixin(Error);\ntype Failure = InstanceType<typeof Failure>;", 'new Failure("f")'),
    "captured": ("class Failure extends Error { code = 7; constructor(m: string) { super(m); Error.captureStackTrace(this, Failure); } BODY }", 'new Failure("f")'),
    "mapcaptured": ("class Failure extends Map<string, number> { code = 7; constructor(m: string) { super(); Error.captureStackTrace(this); } BODY }", 'new Failure("f")'),
    "plaincaptured": ("class Failure { code = 7; constructor(m: string) { Error.captureStackTrace(this); } BODY }", 'new Failure("f")'),
    "returns": ("class Failure { code = 7; constructor(m: string) { return new Error(m) as any; } BODY }", 'new Failure("f")'),
    "constructed": ("class Failure { code = 7; BODY }", 'Reflect.construct(Error, ["f"], Failure) as unknown as Failure'),
    "reparented": ("class Failure { code = 7; BODY }", 'Object.setPrototypeOf(new Error("f"), Failure.prototype) as unknown as Failure'),
    "map": ("class Failure extends Map<string, number> { code = 7; constructor(m: string) { super(); } BODY }", 'new Failure("f")'),
    "plain": ("class Failure { code = 7; constructor(m: string) {} BODY }", 'new Failure("f")'),
}

# name: (statements before, expression with a primitive answer); X is the instance
operations = {
    "ownkeys": ("", "Reflect.ownKeys(X).length"),
    "names": ("", "Object.getOwnPropertyNames(X).length"),
    "symbols": ("", "Object.getOwnPropertySymbols(X).length"),
    "freeze": ("", "Object.freeze(X) === X"),
    "seal": ("", "Object.seal(X) === X"),
    "descriptors": ("", "Object.keys(Object.getOwnPropertyDescriptors(X)).length"),
    "define": ("", 'Object.defineProperty(X, "stack", { value: "s" }) === X'),
    "reflectdefine": ("", 'Reflect.defineProperty(X, "stack", { value: "s" })'),
    "defineother": ("", 'Object.defineProperty(X, "other", { value: 8 }) === X'),
    "defineseveral": ("", 'Object.defineProperties(X, { stack: { value: "s" } }) === X'),
    "stack": ("", "typeof (X as any).stack"),
    "has": ("", '"stack" in X'),
    "hasown": ("", 'Object.hasOwn(X, "stack")'),
    "hasownmethod": ("", '(X as any).hasOwnProperty("stack")'),
    "enumerable": ("", '(X as any).propertyIsEnumerable("stack")'),
    "descriptor": ("", 'typeof Object.getOwnPropertyDescriptor(X, "stack")'),
    "reflectdescriptor": ("", 'typeof Reflect.getOwnPropertyDescriptor(X, "stack")'),
    "delete": ("", "delete (X as any).stack"),
    "reflectdelete": ("", 'Reflect.deleteProperty(X, "stack")'),
    "store": ("", '((X as any).stack = "s") === "s"'),
    "reflectset": ("", 'Reflect.set(X, "stack", "s")'),
    "reflectget": ("", 'typeof Reflect.get(X, "stack")'),
    "reflecthas": ("", 'Reflect.has(X, "stack")'),
    "line": ("", "typeof (X as any).line"),
    "hasline": ("", '"line" in X'),
    "hasownline": ("", 'Object.hasOwn(X, "line")'),
    "storeline": ("", "((X as any).line = 3) === 3"),
    "bykey": ("", "typeof (X as any)[key]"),
    "keys": ("", "Object.keys(X).length"),
    "values": ("", "Object.values(X).length"),
    "entries": ("", "Object.entries(X).length"),
    "assign": ("", "Object.keys(Object.assign({}, X)).length"),
    "spread": ("", "Object.keys({ ...X }).length"),
    "forin": ("let found = 0; for (const name in X) found++;", "found"),
    "clone": ("", "typeof structuredClone(X)"),
    "json": ("", "JSON.stringify(X).length"),
    "isfrozen": ("", "Object.isFrozen(X)"),
    "issealed": ("", "Object.isSealed(X)"),
    "prevent": ("", "Object.preventExtensions(X) === X"),
    "text": ("", "String(X).length"),
    "inspect": ("", "Bun.inspect(X).length > 0"),
}

head = 'let calls = 0;\nconst key = ["stack"][0];\nError.prepareStackTrace = (error: unknown, sites: unknown) => { calls++; return "made"; };\n'

made = 0
for base, (declarations, instance) in bases.items():
    for operation, (before, answer) in operations.items():
        for road in ("param", "this"):
            if road == "param":
                body = f'const before = calls; {before.replace("X", "failure")} const answer = {answer.replace("X", "failure")}; return before + " " + calls + " " + answer;'
                text = head + declarations.replace(" BODY", "") + f"\nfunction look(failure: Failure): string {{ {body} }}\nfor (let turn = 0; turn < 3; turn++) console.log(look({instance}));\n"
            else:
                body = f'const before = calls; {before.replace("X", "this")} const answer = {answer.replace("X", "this")}; return before + " " + calls + " " + answer;'
                text = head + declarations.replace("BODY", f"look(): string {{ {body} }}") + f"\nfor (let turn = 0; turn < 3; turn++) console.log(({instance}).look());\n"
            folder = os.path.join(out, f"{base}.{operation}.{road}")
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, "main.ts"), "w") as file:
                file.write(text)
            made += 1
print(made, "programs:", len(bases), "bases x", len(operations), "operations x 2")
