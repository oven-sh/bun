// Objects with functions that built-in functions and operators call, and uses of those objects.
// Each such function prints its name and how many of them ran before it, so the output says which ran, how often and in what order.

import Foundation

/// BUN_FUZZILLI_CALLBACKS_WEIGHT=<n> makes the generator n times as likely. 0 turns it off.
private let weight = Int(ProcessInfo.processInfo.environment["BUN_FUZZILLI_CALLBACKS_WEIGHT"] ?? "") ?? 1

/// `receiver` is a global object, "" for a global function, "new" for a constructor, or a kind of value: "text", "list", "number", "bytes", "pattern", "map".
/// `arguments` has a letter for each argument: o = an object with hooks, a = an array of them, f = a function that counts, t = JSON text, x = a new object, i = a small integer, r = any value.
private let callsThatCallBack: [(receiver: String, name: String, arguments: String)] = [
    ("JSON", "stringify", "o"), ("JSON", "stringify", "a"), ("JSON", "stringify", "of"), ("JSON", "stringify", "af"),
    ("JSON", "stringify", "oa"), ("JSON", "stringify", "oro"), ("JSON", "stringify", "ofo"), ("JSON", "stringify", "rf"),
    ("JSON", "parse", "tf"), ("JSON", "parse", "tf"), ("JSON", "parse", "o"), ("JSON", "parse", "of"),
    ("", "String", "o"), ("", "Number", "o"), ("", "BigInt", "o"), ("", "Boolean", "o"), ("", "Symbol", "o"), ("", "parseInt", "oo"),
    ("", "parseFloat", "o"), ("", "isNaN", "o"), ("", "isFinite", "o"), ("", "structuredClone", "o"), ("", "Array", "o"),
    ("", "RegExp", "oo"), ("", "encodeURIComponent", "o"), ("", "Object", "o"),
    ("new", "Date", "o"), ("new", "Date", "ooo"), ("new", "Array", "o"), ("new", "Uint8Array", "o"), ("new", "Float64Array", "a"),
    ("new", "Map", "o"), ("new", "Set", "o"), ("new", "Set", "a"), ("new", "Error", "oo"), ("new", "String", "o"), ("new", "Number", "o"),
    ("new", "ArrayBuffer", "oo"), ("new", "RegExp", "oo"), ("new", "WeakSet", "o"), ("new", "AggregateError", "oo"),
    ("Math", "max", "oo"), ("Math", "min", "ooo"), ("Math", "pow", "oo"), ("Math", "atan2", "oo"), ("Math", "hypot", "ooo"),
    ("Math", "imul", "oo"), ("Math", "round", "o"), ("Math", "clz32", "o"),
    ("Date", "UTC", "ooo"), ("String", "fromCharCode", "oo"), ("String", "fromCodePoint", "oo"), ("String", "raw", "oo"),
    ("Number", "isInteger", "o"), ("Number", "parseFloat", "o"),
    ("Array", "from", "o"), ("Array", "from", "of"), ("Array", "from", "af"), ("Array", "of", "oo"), ("Array", "isArray", "o"),
    ("Object", "assign", "xo"), ("Object", "assign", "oo"), ("Object", "keys", "o"), ("Object", "values", "o"), ("Object", "entries", "o"),
    ("Object", "fromEntries", "o"), ("Object", "fromEntries", "a"), ("Object", "defineProperty", "xoo"), ("Object", "defineProperties", "xo"),
    ("Object", "getOwnPropertyDescriptors", "o"), ("Object", "getOwnPropertyDescriptor", "oo"), ("Object", "getOwnPropertyNames", "o"),
    ("Object", "freeze", "o"), ("Object", "seal", "o"), ("Object", "isFrozen", "o"), ("Object", "create", "xo"), ("Object", "create", "o"),
    ("Object", "groupBy", "af"), ("Object", "groupBy", "of"), ("Object", "hasOwn", "oo"), ("Object", "getPrototypeOf", "o"), ("Object", "is", "oo"),
    ("Map", "groupBy", "af"),
    ("Reflect", "ownKeys", "o"), ("Reflect", "get", "oo"), ("Reflect", "get", "xoo"), ("Reflect", "set", "ooi"), ("Reflect", "set", "xoio"),
    ("Reflect", "has", "oo"), ("Reflect", "deleteProperty", "oo"), ("Reflect", "defineProperty", "ooo"), ("Reflect", "apply", "foa"),
    ("Reflect", "apply", "foo"), ("Reflect", "construct", "fo"), ("Reflect", "getOwnPropertyDescriptor", "oo"),
    ("Promise", "resolve", "o"), ("Promise", "all", "a"), ("Promise", "all", "o"), ("Promise", "race", "a"), ("Promise", "allSettled", "a"),
    ("Promise", "any", "o"),
    ("text", "padStart", "oo"), ("text", "slice", "oo"), ("text", "substring", "oo"), ("text", "replace", "oo"), ("text", "replace", "of"),
    ("text", "replaceAll", "of"), ("text", "replaceAll", "oo"), ("text", "indexOf", "oo"), ("text", "lastIndexOf", "oo"), ("text", "repeat", "o"),
    ("text", "at", "o"), ("text", "charCodeAt", "o"), ("text", "split", "oo"), ("text", "localeCompare", "o"), ("text", "concat", "oo"),
    ("text", "includes", "oo"), ("text", "startsWith", "oo"), ("text", "endsWith", "oo"), ("text", "match", "o"), ("text", "matchAll", "o"),
    ("text", "search", "o"), ("text", "normalize", "o"), ("text", "codePointAt", "o"), ("text", "padEnd", "oo"),
    ("list", "join", ""), ("list", "join", "o"), ("list", "sort", ""), ("list", "sort", "f"), ("list", "toSorted", "f"), ("list", "toString", ""),
    ("list", "map", "f"), ("list", "map", "fo"), ("list", "forEach", "f"), ("list", "filter", "f"), ("list", "find", "f"), ("list", "findLast", "f"),
    ("list", "findIndex", "f"), ("list", "some", "f"), ("list", "every", "f"), ("list", "reduce", "f"), ("list", "reduce", "fo"),
    ("list", "reduceRight", "f"), ("list", "flatMap", "f"), ("list", "flat", "o"), ("list", "slice", "oo"), ("list", "splice", "ooo"),
    ("list", "fill", "ooo"), ("list", "at", "o"), ("list", "with", "oo"), ("list", "copyWithin", "ooo"), ("list", "indexOf", "oo"),
    ("list", "lastIndexOf", "oo"), ("list", "includes", "oo"), ("list", "concat", "oa"), ("list", "push", "oo"), ("list", "toSpliced", "ooo"),
    ("list", "toLocaleString", ""), ("list", "unshift", "o"), ("list", "reverse", ""),
    ("number", "toFixed", "o"), ("number", "toString", "o"), ("number", "toPrecision", "o"), ("number", "toExponential", "o"),
    ("bytes", "fill", "ooo"), ("bytes", "set", "ao"), ("bytes", "set", "oo"), ("bytes", "subarray", "oo"), ("bytes", "slice", "oo"),
    ("bytes", "map", "f"), ("bytes", "sort", "f"), ("bytes", "with", "oo"), ("bytes", "indexOf", "oo"), ("bytes", "at", "o"),
    ("bytes", "copyWithin", "ooo"), ("bytes", "join", "o"), ("bytes", "reduce", "fo"), ("bytes", "filter", "f"), ("bytes", "includes", "oo"),
    ("pattern", "test", "o"), ("pattern", "exec", "o"),
    ("map", "get", "o"), ("map", "set", "oo"), ("map", "forEach", "f"), ("map", "forEach", "fo"), ("map", "has", "o"),
]

private let jsonTexts = [
    "{\"a\":1,\"b\":[1,2,{\"c\":null}],\"d\":\"e\"}", "[1,[2,[3]],{\"a\":{\"b\":{}}}]", "{\"a\":1,\"a\":2,\"1\":3,\"0\":4}", "[]", "1",
    "\"text\"", "{\"__proto__\":{\"a\":1},\"b\":-0}", "[true,false,null,1e3,\"\\u0041\"]", "{\"a\":[],\"b\":{},\"c\":[{}]}", "{\"a\":",
]

private let traps = [
    ("get", 3), ("has", 2), ("ownKeys", 1), ("getOwnPropertyDescriptor", 2), ("set", 4), ("deleteProperty", 2), ("defineProperty", 3),
    ("getPrototypeOf", 1), ("isExtensible", 1), ("preventExtensions", 1), ("setPrototypeOf", 2),
]

/// An object literal or a class that is being built.
private protocol HolderOfHooks {
    func addHook(_ name: String, parameters: Int, _ body: ([Variable]) -> Void)
    func addHook(_ key: Variable, parameters: Int, _ body: ([Variable]) -> Void)
    func addCountingGetter(_ name: String, _ body: (Variable) -> Void)
    func addValue(_ name: String, _ value: Variable)
}

extension ProgramBuilder.ObjectLiteral: HolderOfHooks {
    fileprivate func addHook(_ name: String, parameters: Int, _ body: ([Variable]) -> Void) {
        addMethod(name, with: .parameters(n: parameters), body)
    }
    fileprivate func addHook(_ key: Variable, parameters: Int, _ body: ([Variable]) -> Void) {
        addComputedMethod(key, with: .parameters(n: parameters), body)
    }
    fileprivate func addCountingGetter(_ name: String, _ body: (Variable) -> Void) { addGetter(for: name, body) }
    fileprivate func addValue(_ name: String, _ value: Variable) { addProperty(name, as: value) }
}

extension ProgramBuilder.ClassDefinition: HolderOfHooks {
    fileprivate func addHook(_ name: String, parameters: Int, _ body: ([Variable]) -> Void) {
        addInstanceMethod(name, with: .parameters(n: parameters), body)
    }
    fileprivate func addHook(_ key: Variable, parameters: Int, _ body: ([Variable]) -> Void) {
        addInstanceComputedMethod(key, with: .parameters(n: parameters), body)
    }
    fileprivate func addCountingGetter(_ name: String, _ body: (Variable) -> Void) { addInstanceGetter(for: name, body) }
    fileprivate func addValue(_ name: String, _ value: Variable) { addInstanceProperty(name, value: value) }
}

extension ProgramBuilder {
    /// `printValue("<name>", ++counter, ..)`
    fileprivate func printCall(_ name: String, _ counter: Variable, _ shown: [Variable] = []) {
        unary(.PreInc, counter)
        callFunction(createNamedVariable(forBuiltin: "printValue"), withArgs: [loadString(name), counter] + shown)
    }

    fileprivate func loadResultOfHook(this: Variable) -> Variable {
        switch Int.random(in: 0..<14) {
        case 0...4: return loadInt(Int64.random(in: -1...4))
        case 5, 6: return loadString(chooseUniform(from: ["1", "a", "length", "0", "", "b", "a,b"]))
        case 7: return loadFloat(chooseUniform(from: [0.5, -0.0, Double.nan, 1e21, 2.5]))
        case 8: return loadBool(Bool.random())
        case 9: return loadUndefined()
        case 10: return loadNull()
        case 11: return loadBigInt(2)
        case 12: return this
        default: return randomJsVariable()
        }
    }

    fileprivate func returnFromHook(this: Variable) {
        if probability(0.04) {
            throwException(loadString("thrown by a hook"))
        } else {
            doReturn(loadResultOfHook(this: this))
        }
    }

    /// `[Symbol.iterator]() { return { next() { .. }, return() { .. } }; }`, which ends after a few steps.
    fileprivate func fillIteratorMethod(_ counter: Variable, _ values: [Variable]) {
        printCall("iterator", counter)
        let step = loadInt(0)
        let last = loadInt(Int64.random(in: 0...3))
        let value = chooseUniform(from: values)
        let hasReturn = probability(0.7)
        let yieldsPairs = probability(0.3)
        doReturn(
            buildObjectLiteral { iterator in
                iterator.addMethod("next", with: .parameters(n: 1)) { _ in
                    self.printCall("next", counter)
                    self.unary(.PreInc, step)
                    let done = self.compare(step, with: last, using: .greaterThan)
                    let yielded = yieldsPairs ? self.createArray(with: [step, value]) : probability(0.5) ? step : value
                    self.doReturn(
                        self.buildObjectLiteral { result in
                            if probability(0.3) {
                                result.addGetter(for: "done") { _ in
                                    self.printCall("get done", counter)
                                    self.doReturn(done)
                                }
                                result.addGetter(for: "value") { _ in
                                    self.printCall("get value", counter)
                                    self.doReturn(yielded)
                                }
                            } else {
                                result.addProperty("done", as: done)
                                result.addProperty("value", as: yielded)
                            }
                        })
                }
                if hasReturn {
                    iterator.addMethod("return", with: .parameters(n: 1)) { _ in
                        self.printCall("return", counter)
                        if probability(0.85) {
                            self.doReturn(self.buildObjectLiteral { _ in })
                        } else {
                            self.doReturn(self.loadInt(1))
                        }
                    }
                }
            })
    }

    fileprivate func addHooks(to holder: HolderOfHooks, _ counter: Variable, symbols: [String: Variable], values: [Variable]) {
        for (index, name) in ["a", "b", "c", "length"].enumerated() where probability(0.45) {
            if probability(0.5) {
                holder.addCountingGetter(name) { this in
                    self.printCall("get " + name, counter)
                    self.doReturn(name == "length" ? self.loadInt(Int64.random(in: 0...3)) : self.loadResultOfHook(this: this))
                }
            } else {
                holder.addValue(name, values[index % values.count])
            }
        }
        for name in ["toJSON", "valueOf", "toString"] where probability(0.6) {
            holder.addHook(name, parameters: 1) { arguments in
                self.printCall(name, counter, name == "toJSON" ? [arguments[1]] : [])
                self.returnFromHook(this: arguments[0])
            }
        }
        if probability(0.35) {
            holder.addHook(symbols["toPrimitive"]!, parameters: 1) { arguments in
                self.printCall("toPrimitive", counter, [arguments[1]])
                self.returnFromHook(this: arguments[0])
            }
        }
        if probability(0.4) {
            holder.addHook(symbols["iterator"]!, parameters: 0) { _ in self.fillIteratorMethod(counter, values) }
        }
        if probability(0.1) {
            holder.addHook("then", parameters: 2) { arguments in
                self.printCall("then", counter)
                self.callFunction(arguments[probability(0.8) ? 1 : 2], withArgs: [self.loadInt(7)], guard: true)
            }
        }
        for name in ["get", "set", "value", "enumerable", "configurable", "writable", "cause", "flags", "source", "lastIndex", "raw"]
        where probability(0.06) {
            holder.addCountingGetter(name) { this in
                self.printCall("get " + name, counter)
                self.doReturn(self.loadResultOfHook(this: this))
            }
        }
    }

    /// Each trap prints its name and the key, and does what the operation does without a trap.
    fileprivate func buildCountingProxy(of target: Variable, _ counter: Variable) -> Variable {
        let reflect = createNamedVariable(forBuiltin: "Reflect")
        let handler = buildObjectLiteral { handler in
            for (name, parameters) in traps where probability(0.6) {
                handler.addMethod(name, with: .parameters(n: parameters)) { arguments in
                    let passedOn = Array(arguments.dropFirst())
                    self.printCall(name, counter, parameters > 1 && name != "setPrototypeOf" ? [passedOn[1]] : [])
                    self.doReturn(self.callMethod(name, on: reflect, withArgs: passedOn))
                }
            }
        }
        return construct(createNamedVariable(forBuiltin: "Proxy"), withArgs: [target, handler])
    }

    /// An object literal, an instance of a class, an object that inherits from one of these, or a proxy of one.
    fileprivate func buildObjectWithHooks(_ counter: Variable) -> Variable {
        let symbols = ["toPrimitive": createSymbolProperty("toPrimitive"), "iterator": createSymbolProperty("iterator")]
        let values = [loadInt(Int64.random(in: -2...9)), loadString("v"), randomJsVariable(), createArray(with: [loadInt(1), loadInt(2)])]
        var object: Variable
        if probability(0.65) {
            object = buildObjectLiteral { self.addHooks(to: $0, counter, symbols: symbols, values: values) }
        } else {
            object = construct(buildClassDefinition { self.addHooks(to: $0, counter, symbols: symbols, values: values) })
        }
        if probability(0.15) { object = callMethod("create", on: createNamedVariable(forBuiltin: "Object"), withArgs: [object]) }
        if probability(0.25) { object = buildCountingProxy(of: object, counter) }
        return object
    }

    /// A function for a built-in to call: a replacer, a reviver, a comparator, a callback of an array method.
    fileprivate func buildCountingFunction(_ counter: Variable, _ objects: [Variable]) -> Variable {
        buildPlainFunction(with: .parameters(n: 3)) { arguments in
            printCall("callback", counter, Array(arguments.prefix(2)))
            if probability(0.15) {
                let this = loadThis()
                if probability(0.5) {
                    setProperty(chooseUniform(from: ["a", "b", "added"]), of: this, to: loadInt(9), guard: true)
                } else {
                    setProperty("length", of: this, to: loadInt(1), guard: true)
                }
            }
            switch Int.random(in: 0..<9) {
            case 0: doReturn(arguments[0])
            case 1, 2, 3: doReturn(arguments[1])
            case 4: doReturn(chooseUniform(from: objects))
            case 5: doReturn(loadResultOfHook(this: arguments[1]))
            case 6: doReturn(binary(arguments[0], arguments[1], with: .Sub))
            case 7: doReturn(loadBool(Bool.random()))
            default: break
            }
        }
    }

    fileprivate func buildArgument(_ kind: Character, _ counter: Variable, _ objects: [Variable]) -> Variable {
        switch kind {
        case "o": return chooseUniform(from: objects)
        case "a": return createArray(with: objects.shuffled() + (probability(0.5) ? [loadInt(3)] : []))
        case "f": return buildCountingFunction(counter, objects)
        case "t": return loadString(chooseUniform(from: jsonTexts))
        case "x": return buildObjectLiteral { _ in }
        case "i": return loadInt(Int64.random(in: 0...3))
        default: return randomJsVariable()
        }
    }

    fileprivate func buildReceiver(_ kind: String, _ objects: [Variable]) -> Variable {
        switch kind {
        case "text": return loadString(chooseUniform(from: ["a-b-a", "abc", "", "1,2"]))
        case "list": return createArray(with: objects.shuffled() + [loadInt(2), loadInt(1)])
        case "number": return loadFloat(chooseUniform(from: [5.5, 255, 0, 1e21]))
        case "bytes": return construct(createNamedVariable(forBuiltin: "Uint8Array"), withArgs: [loadInt(4)])
        case "pattern": return construct(createNamedVariable(forBuiltin: "RegExp"), withArgs: [loadString("a|1"), loadString(probability(0.5) ? "g" : "")])
        case "map":
            let entries = createArray(with: objects.map { createArray(with: [$0, loadInt(1)]) })
            return construct(createNamedVariable(forBuiltin: "Map"), withArgs: [entries])
        default: return createNamedVariable(forBuiltin: kind)
        }
    }

    /// Prints what `use` results in or the name of what it throws, and then how many hooks have run.
    fileprivate func printOutcome(of label: String, _ counter: Variable, _ use: () -> Variable?) {
        let print = createNamedVariable(forBuiltin: "printValue")
        buildTryCatchFinally(
            tryBody: {
                if let result = use() { callFunction(print, withArgs: [loadString(label), result]) }
            },
            catchBody: { error in
                let name = self.getProperty("name", of: error, isReceiverOptional: true)
                self.callFunction(print, withArgs: [self.loadString(label + " threw"), name])
            })
        callFunction(print, withArgs: [loadString("hooks ran"), counter])
    }

    fileprivate func buildCallThatCallsBack(_ counter: Variable, _ objects: [Variable]) {
        let call = chooseUniform(from: callsThatCallBack)
        // A function that is declared in a block has another name under `bun run`, so the arguments stand in front of the try block.
        let arguments = call.arguments.map { buildArgument($0, counter, objects) }
        let receiver = ["", "new"].contains(call.receiver) ? createNamedVariable(forBuiltin: call.name) : buildReceiver(call.receiver, objects)
        printOutcome(of: call.name, counter) {
            switch call.receiver {
            case "": return callFunction(receiver, withArgs: arguments)
            case "new": return construct(receiver, withArgs: arguments)
            default: return callMethod(call.name, on: receiver, withArgs: arguments)
            }
        }
    }

    fileprivate func buildOperatorThatCallsBack(_ counter: Variable, _ objects: [Variable]) {
        let (first, second) = (chooseUniform(from: objects), chooseUniform(from: objects))
        let other = probability(0.5) ? second : loadResultOfHook(this: second)
        printOutcome(of: "operator", counter) {
            switch Int.random(in: 0..<12) {
            case 0: return unary(chooseUniform(from: [.Plus, .Minus, .BitwiseNot, .LogicalNot]), first)
            case 1, 2: return binary(first, other, with: chooseUniform(from: BinaryOperator.allCases))
            case 3: return binary(other, first, with: chooseUniform(from: BinaryOperator.allCases))
            case 4, 5: return compare(first, with: other, using: chooseUniform(from: Comparator.allCases))
            case 6: return createTemplateString(from: ["<", "|", ">"], interpolating: [first, other])
            case 7: return getComputedProperty(first, of: second)
            case 8: return testIn(first, second)
            case 9:
                let holder = buildObjectLiteral { $0.addComputedProperty(first, as: other) }
                return holder
            case 10: return buildObjectLiteral { $0.copyProperties(from: first) }
            default:
                let copy = dup(first)
                return unary(chooseUniform(from: [.PreInc, .PostInc, .PreDec, .PostDec]), copy)
            }
        }
    }

    fileprivate func buildIterationThatCallsBack(_ counter: Variable, _ objects: [Variable]) {
        let iterated = chooseUniform(from: objects)
        let function = buildCountingFunction(counter, objects)
        printOutcome(of: "iteration", counter) {
            switch Int.random(in: 0..<7) {
            case 0: return createArray(with: [loadInt(0), iterated], spreading: [false, true])
            case 1: return createArray(with: destruct(iterated, selecting: [0, 1]))
            case 2: return createArray(with: destruct(iterated, selecting: [0, 2], lastIsRest: true))
            case 3: return createArray(with: destruct(iterated, selecting: ["a", "b"], hasRestElement: probability(0.5)))
            case 4: return callFunction(function, withArgs: [iterated], spreading: [true])
            default:
                let isForOf = probability(0.7)
                let stopsEarly = probability(0.5)
                buildForInOfLoop(iterated, type: isForOf ? .forOf : .forIn, isAsync: false, header: .simple) { elements, _ in
                    printCall("body", counter, elements)
                    if stopsEarly { loopBreak() }
                }
                return nil
            }
        }
    }
}

// Below: an object that the program holds, something that a built-in calls or constructs and that stores into the object, or a built-in that stores into it by itself,
// and reads of the object's members by name behind that.

/// Members that the program's functions store. Built-ins store some of them too.
private let storedNames = ["added", "a", "b", "c", "lastIndex", "length", "index", "value", "size"]

private enum KindOfHook { case called, calledWithThis, constructed }

private struct SceneOfStores {
    let held: Variable
    let counter: Variable
    /// The members that the functions of this scene store and that it reads.
    let names: [String]
    /// For each of the names, a function that returns that member of its argument.
    let readers: [Variable]
    let usesStandInTryBlocks: Bool
}

extension ProgramBuilder {
    fileprivate func global(_ name: String) -> Variable { createNamedVariable(forBuiltin: name) }
    fileprivate func literal(_ key: String, _ value: Variable) -> Variable { buildObjectLiteral { $0.addProperty(key, as: value) } }
    fileprivate func literal(_ key: Variable, _ value: Variable) -> Variable { buildObjectLiteral { $0.addComputedProperty(key, as: value) } }

    /// `Holder.prototype.name.call(this, ..)`
    fileprivate func callMethodOfPrototype(_ holder: String, _ name: String, this: Variable, _ arguments: [Variable] = []) -> Variable {
        callMethod("call", on: getProperty(name, of: getProperty("prototype", of: global(holder))), withArgs: [this] + arguments)
    }

    /// An instance of a class or of a function, an object literal, an object that inherits from one, or an array. It has a member `c` that is an object.
    fileprivate func buildHeldObject() -> Variable {
        let (a, text, inner) = (loadInt(Int64.random(in: 0...5)), loadString("text"), literal("inner", loadInt(1)))
        let (hasA, hasB) = (probability(0.7), probability(0.7))
        switch Int.random(in: 0..<10) {
        case 0...3:
            return construct(
                buildClassDefinition { definition in
                    if hasA { definition.addInstanceProperty("a", value: a) }
                    definition.addInstanceProperty("c", value: inner)
                    if hasB { definition.addInstanceProperty("b", value: text) }
                })
        case 4...6:
            let object = buildObjectLiteral { object in
                if hasA { object.addProperty("a", as: a) }
                object.addProperty("c", as: inner)
                if hasB { object.addProperty("b", as: text) }
            }
            return probability(0.25) ? callMethod("create", on: global("Object"), withArgs: [object]) : object
        case 7, 8:
            return construct(
                buildConstructor(with: .parameters(n: 0)) { arguments in
                    if hasA { setProperty("a", of: arguments[0], to: a) }
                    setProperty("c", of: arguments[0], to: inner)
                    if hasB { setProperty("b", of: arguments[0], to: text) }
                })
        default:
            let list = createArray(with: [a, text])
            setProperty("c", of: list, to: inner)
            return list
        }
    }

    fileprivate func loadStoredValue(_ held: Variable) -> Variable {
        switch Int.random(in: 0..<10) {
        case 0, 1, 2: return loadInt(Int64.random(in: -1...9))
        case 3: return loadFloat(chooseUniform(from: [0.5, -0.0, 2.5, Double.nan]))
        case 4: return loadString(chooseUniform(from: ["s", "", "1"]))
        case 5, 6: return getProperty("c", of: held)
        case 7: return literal("inner", loadInt(5))
        case 8: return createArray(with: [loadInt(1), loadString("e")])
        default: return probability(0.5) ? loadUndefined() : loadBool(Bool.random())
        }
    }

    /// One store to a member of `target`, written in one of several ways. A setter doesn't store to its own name.
    fileprivate func store(_ scene: SceneOfStores, into target: Variable, except avoided: String? = nil) {
        let name = chooseUniform(from: scene.names.filter { $0 != avoided })
        let value = loadStoredValue(scene.held)
        switch Int.random(in: 0..<13) {
        case 0, 1, 2: setProperty(name, of: target, to: value)
        case 3: setComputedProperty(loadString(name), of: target, to: value)
        case 4, 5, 6: callMethod("assign", on: global("Object"), withArgs: [target, literal(name, value)])
        case 7:
            let (isEnumerable, isWritable) = (loadBool(probability(0.7)), loadBool(probability(0.7)))
            let descriptor = buildObjectLiteral { descriptor in
                descriptor.addProperty("value", as: value)
                descriptor.addProperty("enumerable", as: isEnumerable)
                descriptor.addProperty("writable", as: isWritable)
                descriptor.addProperty("configurable", as: isWritable)
            }
            callMethod("defineProperty", on: global("Object"), withArgs: [target, loadString(name), descriptor])
        case 8: callMethod("set", on: global("Reflect"), withArgs: [target, loadString(name), value])
        case 9: callMethod("set", on: global("Reflect"), withArgs: [buildObjectLiteral { _ in }, loadString(name), value, target])
        case 10: deleteProperty(name, of: target)
        case 11: callMethod("setPrototypeOf", on: global("Object"), withArgs: [target, literal(name, value)])
        default: setProperty("inner", of: getProperty("c", of: target), to: value, guard: true)
        }
    }

    fileprivate func fillHook(_ scene: SceneOfStores, _ name: String, _ kind: KindOfHook, _ arguments: [Variable], _ answer: ([Variable]) -> Variable?) {
        // Where the function stores nothing, the built-in that calls it is the only one that does.
        if probability(0.75) { printCall(name, scene.counter) }
        if probability(0.6) { store(scene, into: kind == .calledWithThis && probability(0.4) ? loadThis() : scene.held) }
        if let result = answer(arguments) { doReturn(result) }
    }

    /// A function that stores into the held object and returns what `answer` builds. A built-in calls or constructs it.
    /// Swift 6.3.3 stops in its optimizer when it inlines this into a function that computes `name`.
    @inline(never)
    fileprivate func buildHook(
        _ scene: SceneOfStores, _ name: String, _ kind: KindOfHook = .called, parameters: Int = 2, _ answer: ([Variable]) -> Variable? = { _ in nil }
    ) -> Variable {
        if kind == .called && probability(0.3) {
            return buildArrowFunction(with: .parameters(n: parameters)) { fillHook(scene, name, kind, $0, answer) }
        }
        return buildPlainFunction(with: .parameters(n: parameters)) { fillHook(scene, name, kind, $0, answer) }
    }

    /// `held.exec = function () { .. }`, which finds something the first time that it is called.
    fileprivate func giveExec(_ scene: SceneOfStores) {
        let step = loadInt(0)
        let exec = buildHook(scene, "exec", .calledWithThis, parameters: 1) { _ in
            unary(.PreInc, step)
            buildIf(compare(step, with: loadInt(1), using: .equal)) { doReturn(createArray(with: [loadString("")])) }
            return loadNull()
        }
        setProperty("exec", of: scene.held, to: exec)
    }

    /// `key` is the name of a well-known symbol or of a member. The function becomes that member of the held object or of a new one.
    fileprivate func buildHolder(_ scene: SceneOfStores, of function: Variable, as key: String, isSymbol: Bool) -> Variable {
        if probability(0.5) {
            if isSymbol {
                setComputedProperty(createSymbolProperty(key), of: scene.held, to: function)
            } else {
                setProperty(key, of: scene.held, to: function)
            }
            return scene.held
        }
        return isSymbol ? literal(createSymbolProperty(key), function) : literal(key, function)
    }

    fileprivate func printMembers(_ scene: SceneOfStores) {
        let print = global("printValue")
        let held = scene.held
        let alsoRead = ["lastIndex", "length"].filter { !scene.names.contains($0) && probability(0.5) }
        for (index, name) in (scene.names + alsoRead).enumerated() {
            switch Int.random(in: 0..<6) {
            case 0, 1: callFunction(print, withArgs: [loadString(name), getProperty(name, of: held)])
            case 2: callFunction(print, withArgs: [loadString("typeof " + name), typeof(getProperty(name, of: held))])
            case 3 where index < scene.readers.count: callFunction(print, withArgs: [loadString(name), callFunction(scene.readers[index], withArgs: [held])])
            case 4: callFunction(print, withArgs: [loadString("has " + name), testIn(loadString(name), held)])
            default: callFunction(print, withArgs: [loadString(name), destruct(held, selecting: [name])[0]])
            }
        }
        if probability(0.4) { callFunction(print, withArgs: [loadString("0"), getElement(0, of: held)]) }
        let keys = callMethod("keys", on: global("Object"), withArgs: [held])
        callFunction(print, withArgs: [loadString("keys"), callMethod("join", on: keys, withArgs: [loadString("+")])])
    }

    /// What `use` results in is printed, printed in part, or not used. Then come the members of the held object. One of them may also be read in front of the use. All of it may stand in a loop.
    fileprivate func printUse(_ scene: SceneOfStores, _ label: String, _ use: () -> Variable?) {
        let way = Int.random(in: 0..<8)
        let read = chooseUniform(from: scene.names + ["lastIndex", "length"])
        func shown() -> Variable? {
            guard let result = use() else { return nil }
            switch way {
            case 0, 1: return result
            case 2: return typeof(result)
            case 3: return getProperty("length", of: result, isReceiverOptional: true)
            case 4: return binary(typeof(result), typeof(getProperty(read, of: scene.held)), with: .Add)
            default: return nil
            }
        }
        let before = probability(0.4) ? getProperty(read, of: scene.held) : nil
        func useAndRead() {
            if scene.usesStandInTryBlocks {
                printOutcome(of: label, scene.counter, shown)
            } else if let result = shown() {
                callFunction(global("printValue"), withArgs: [loadString(label), result])
            }
            if let before {
                callFunction(global("printValue"), withArgs: [loadString("before and after"), before, getProperty(read, of: scene.held)])
            }
            printMembers(scene)
        }
        if probability(0.2) {
            buildRepeatLoop(n: Int.random(in: 2...3)) { useAndRead() }
        } else {
            useAndRead()
        }
    }

    fileprivate func buildUseThatStores(_ scene: SceneOfStores) {
        let held = scene.held
        let name = chooseUniform(from: scene.names)
        let answersHeld = probability(0.65)
        let list = createArray(with: [loadInt(3), loadInt(1), loadInt(2)])
        let species = createSymbolProperty("species")
        switch Int.random(in: 0..<25) {
        case 0:
            let constructor = buildHook(scene, "species", .constructed, parameters: 1) { _ in answersHeld ? held : nil }
            setProperty("constructor", of: list, to: literal(species, constructor))
            let callback = buildHook(scene, "callback") { $0[0] }
            let uses: [(String, [Variable])] = [
                ("map", [callback]), ("filter", [callback]), ("flatMap", [callback]), ("slice", []), ("splice", [loadInt(0), loadInt(2)]),
                ("concat", [loadInt(4)]), ("flat", []),
            ]
            let (method, arguments) = chooseUniform(from: uses)
            printUse(scene, method) { callMethod(method, on: list, withArgs: arguments) }
        case 1:
            let pattern = construct(global("RegExp"), withArgs: [loadString(","), loadString(probability(0.5) ? "g" : "")])
            let constructor = buildHook(scene, "species", .constructed) { _ in answersHeld ? held : nil }
            setProperty("constructor", of: pattern, to: literal(species, constructor))
            if probability(0.7) { giveExec(scene) }
            let splits = probability(0.7)
            printUse(scene, splits ? "split" : "matchAll") {
                if splits { return callMethod("split", on: loadString("a,b"), withArgs: [pattern]) }
                return createArray(with: [callMethod("matchAll", on: loadString("a,b"), withArgs: [pattern])], spreading: [true])
            }
        case 2:
            let promise = callMethod("resolve", on: global("Promise"), withArgs: [loadInt(1)])
            let settle = buildArrowFunction(with: .parameters(n: 1)) { _ in }
            let constructor = buildHook(scene, "species", .constructed, parameters: 1) { arguments in
                callFunction(arguments[0], withArgs: [settle, settle])
                return answersHeld ? held : nil
            }
            setProperty("constructor", of: promise, to: literal(species, constructor))
            let reaction = buildHook(scene, "reaction", parameters: 1) { $0[0] }
            let method = chooseUniform(from: ["then", "finally", "catch"])
            printUse(scene, method) { typeof(callMethod(method, on: promise, withArgs: [reaction])) }
        case 3:
            let bytes = construct(global("Uint8Array"), withArgs: [loadInt(4)])
            let constructor = buildHook(scene, "species", .constructed, parameters: 1) { construct(global("Uint8Array"), withArgs: [$0[0]]) }
            setProperty("constructor", of: bytes, to: literal(species, constructor))
            let callback = buildHook(scene, "callback") { $0[0] }
            let uses: [(String, [Variable])] = [("slice", []), ("map", [callback]), ("filter", [callback]), ("subarray", [loadInt(1)])]
            let (method, arguments) = chooseUniform(from: uses)
            printUse(scene, method) { callMethod(method, on: bytes, withArgs: arguments) }
        case 4:
            let method = chooseUniform(from: ["split", "replace", "replaceAll", "match", "matchAll", "search"])
            let function = buildHook(scene, method, .calledWithThis) { _ in answersHeld ? held : loadInt(1) }
            let searched = buildHolder(scene, of: function, as: method, isSymbol: true)
            printUse(scene, method) { callMethod(method, on: loadString("a-b"), withArgs: [searched, loadString("x")]) }
        case 5:
            let step = loadInt(0)
            let next = buildHook(scene, "next", .calledWithThis, parameters: 0) { _ in
                unary(.PreInc, step)
                let done = compare(step, with: loadInt(2), using: .greaterThan)
                if answersHeld {
                    setProperty("done", of: held, to: done)
                    setProperty("value", of: held, to: step)
                    return held
                }
                return buildObjectLiteral { result in
                    result.addProperty("done", as: done)
                    result.addProperty("value", as: step)
                }
            }
            let iterator = buildHook(scene, "iterator", .calledWithThis, parameters: 0) { _ in literal("next", next) }
            let iterated = buildHolder(scene, of: iterator, as: "iterator", isSymbol: true)
            let way = Int.random(in: 0..<7)
            printUse(scene, "iteration") {
                switch way {
                case 0: return createArray(with: [iterated], spreading: [true])
                case 1: return callMethod("from", on: global("Array"), withArgs: [iterated])
                case 2: return construct(global("Set"), withArgs: [iterated])
                case 3: return createArray(with: destruct(iterated, selecting: [0, 1]))
                case 4: return callMethod("fromEntries", on: global("Object"), withArgs: [iterated])
                case 5: return typeof(callMethod("all", on: global("Promise"), withArgs: [iterated]))
                default: return callMethod("max", on: global("Math"), withArgs: [iterated], spreading: [true])
                }
            }
        case 6:
            let key = chooseUniform(from: ["valueOf", "toString", "toString", "toPrimitive"])
            let function = buildHook(scene, key, .calledWithThis, parameters: 1) { _ in
                probability(0.6) ? loadString(name) : loadInt(Int64.random(in: 0...2))
            }
            let converted = buildHolder(scene, of: function, as: key, isSymbol: key == "toPrimitive")
            let value = loadStoredValue(held)
            let way = Int.random(in: 0..<14)
            printUse(scene, "conversion") {
                switch way {
                case 0, 1, 2: return getComputedProperty(converted, of: held)
                case 3:
                    setComputedProperty(converted, of: held, to: value)
                    return nil
                case 4: return unary(.Plus, converted)
                case 5: return createTemplateString(from: ["<", ">"], interpolating: [converted])
                case 6: return binary(converted, loadString(""), with: .Add)
                case 7: return testIn(converted, held)
                case 8: return callMethod("hasOwn", on: global("Object"), withArgs: [held, converted])
                case 9: return callMethod("at", on: list, withArgs: [converted])
                case 10: return callMethod("get", on: global("Reflect"), withArgs: [held, converted])
                case 11: return callMethod("set", on: global("Reflect"), withArgs: [held, converted, value])
                case 12: return typeof(callMethod("defineProperty", on: global("Object"), withArgs: [held, converted, literal("value", value)]))
                default: return callMethod("getOwnPropertyDescriptor", on: global("Object"), withArgs: [held, converted])
                }
            }
        case 7:
            let host = chooseUniform(from: ["then", "then", "queueMicrotask", "setTimeout", "setImmediate", "nextTick"])
            let then = buildHook(scene, "then", .calledWithThis) { arguments in
                callFunction(arguments[0], withArgs: [loadInt(1)])
                return nil
            }
            let (awaitsThenable, isNextTick) = (host == "then", host == "nextTick")
            let thenable = awaitsThenable ? buildHolder(scene, of: then, as: "then", isSymbol: false) : then
            let caller = isNextTick ? global("process") : awaitsThenable ? then : global(host)
            let function = buildAsyncFunction(with: .parameters(n: 0)) { _ in
                var awaited = thenable
                if !awaitsThenable {
                    let executor = buildArrowFunction(with: .parameters(n: 1)) { arguments in
                        let callback = buildHook(scene, "callback of the host", parameters: 0) { _ in
                            callFunction(arguments[0], withArgs: [loadInt(1)])
                            return nil
                        }
                        if isNextTick {
                            callMethod("nextTick", on: caller, withArgs: [callback])
                        } else {
                            callFunction(caller, withArgs: [callback])
                        }
                    }
                    awaited = construct(global("Promise"), withArgs: [executor])
                }
                callFunction(global("printValue"), withArgs: [loadString("awaited"), self.await(awaited)])
                printMembers(scene)
            }
            printUse(scene, host) { typeof(callFunction(function)) }
        case 8:
            let json = global("JSON")
            let way = Int.random(in: 0..<4)
            let function = buildHook(scene, way == 0 ? "toJSON" : way == 3 ? "reviver" : "replacer", .calledWithThis) { arguments in
                way == 0 ? (answersHeld ? held : loadInt(1)) : way == 3 && answersHeld ? held : arguments[1]
            }
            let serialized = way == 0 ? buildHolder(scene, of: function, as: "toJSON", isSymbol: false) : way == 1 ? held : literal("k", held)
            printUse(scene, "JSON") {
                switch way {
                case 0: return callMethod("stringify", on: json, withArgs: [serialized])
                case 3: return callMethod("parse", on: json, withArgs: [loadString(chooseUniform(from: jsonTexts)), function])
                default: return callMethod("stringify", on: json, withArgs: [serialized, function])
                }
            }
        case 9:
            let way = Int.random(in: 0..<9)
            let callback = buildHook(scene, "callback", way < 5 ? .calledWithThis : .called) { $0[0] }
            let method = chooseUniform(from: ["map", "forEach", "filter", "find", "findLast", "some", "every", "flatMap", "findIndex"])
            printUse(scene, "callback") {
                switch way {
                case 0, 1: return callMethod(method, on: list, withArgs: [callback, held])
                case 2: return callMethod("from", on: global("Array"), withArgs: [list, callback, held])
                case 3: return callMethod("forEach", on: construct(global("Set"), withArgs: [list]), withArgs: [callback, held])
                case 4: return callMethod("map", on: construct(global("Uint8Array"), withArgs: [list]), withArgs: [callback, held])
                case 5: return callMethod(chooseUniform(from: ["sort", "toSorted", "reduce", "reduceRight"]), on: list, withArgs: [callback])
                case 6: return callMethod("replace", on: loadString("abc"), withArgs: [loadString("b"), callback])
                case 7: return callMethod("groupBy", on: global("Object"), withArgs: [list, callback])
                default: return callMethod("replace", on: loadString("abc"), withArgs: [construct(global("RegExp"), withArgs: [loadString("[ac]"), loadString("g")]), callback])
                }
            }
        case 10:
            let value = loadStoredValue(held)
            let hasSetter = probability(0.4)
            let other = buildObjectLiteral { object in
                if hasSetter {
                    object.addSetter(for: name) { this, _ in
                        printCall("set " + name, scene.counter)
                        store(scene, into: probability(0.5) ? this : held, except: name)
                    }
                } else {
                    object.addGetter(for: name) { this in
                        printCall("get " + name, scene.counter)
                        store(scene, into: probability(0.3) ? this : held)
                        doReturn(value)
                    }
                }
                object.addProperty("z", as: value)
            }
            let way = Int.random(in: 0..<8)
            printUse(scene, hasSetter ? "setter" : "getter") {
                if hasSetter {
                    switch way {
                    case 0, 1, 2: return callMethod("assign", on: global("Object"), withArgs: [other, literal(name, value)])
                    case 3, 4: return callMethod("set", on: global("Reflect"), withArgs: [other, loadString(name), value, held])
                    default:
                        callMethod("setPrototypeOf", on: global("Object"), withArgs: [held, other])
                        setProperty(name, of: held, to: value)
                        return nil
                    }
                }
                switch way {
                case 0, 1: return callMethod("assign", on: global("Object"), withArgs: [held, other])
                case 2: return callMethod("assign", on: global("Object"), withArgs: [buildObjectLiteral { _ in }, other])
                case 3: return buildObjectLiteral { $0.copyProperties(from: other) }
                case 4: return callMethod(chooseUniform(from: ["values", "entries"]), on: global("Object"), withArgs: [other])
                case 5: return callMethod("stringify", on: global("JSON"), withArgs: [other])
                case 6: return callMethod("get", on: global("Reflect"), withArgs: [other, loadString(name), held])
                default: return callFunction(global("structuredClone"), withArgs: [other])
                }
            }
        case 11:
            let way = Int.random(in: 0..<3)
            let key = createSymbolProperty(["hasInstance", "isConcatSpreadable", "toStringTag"][way])
            let test = buildHook(scene, "hasInstance", .calledWithThis, parameters: 1) { _ in loadBool(true) }
            let answer = way == 1 ? loadBool(Bool.random()) : loadString("tag")
            let other = way == 0 ? literal(key, test) : buildObjectLiteral { object in
                object.addComputedGetter(for: key) { _ in
                    printCall("get", scene.counter)
                    store(scene, into: held)
                    doReturn(answer)
                }
            }
            printUse(scene, "symbol") {
                switch way {
                case 0: return testInstanceOf(held, other)
                case 1: return callMethod("concat", on: list, withArgs: [other])
                default: return callMethodOfPrototype("Object", "toString", this: other)
                }
            }
        case 12:
            let reflect = global("Reflect")
            let chosen = traps.filter { _ in probability(0.25) }
            let functions = chosen.map { trap in
                buildHook(scene, trap.0, .called, parameters: trap.1) { callMethod(trap.0, on: reflect, withArgs: $0) }
            }
            let handler = buildObjectLiteral { handler in
                for (trap, function) in zip(chosen, functions) { handler.addProperty(trap.0, as: function) }
            }
            let proxy = construct(global("Proxy"), withArgs: [probability(0.8) ? held : buildObjectLiteral { _ in }, handler])
            let value = loadStoredValue(held)
            let way = Int.random(in: 0..<10)
            printUse(scene, "proxy") {
                switch way {
                case 0: return callMethod("keys", on: global("Object"), withArgs: [proxy])
                case 1: return buildObjectLiteral { $0.copyProperties(from: proxy) }
                case 2: return typeof(callMethod("assign", on: global("Object"), withArgs: [proxy, literal(name, value)]))
                case 3: return testIn(loadString(name), proxy)
                case 4: return getProperty(name, of: proxy)
                case 5, 6:
                    setProperty(name, of: proxy, to: value)
                    return nil
                case 7: return deleteProperty(name, of: proxy)
                case 8: return typeof(callMethod("defineProperty", on: global("Object"), withArgs: [proxy, loadString(name), literal("value", value)]))
                default: return typeof(callMethod("getPrototypeOf", on: global("Object"), withArgs: [proxy]))
                }
            }
        case 13:
            let constructor = buildHook(scene, "constructor", .constructed, parameters: 1) { _ in answersHeld ? held : nil }
            let isFrom = probability(0.5)
            printUse(scene, isFrom ? "from" : "of") {
                let function = getProperty(isFrom ? "from" : "of", of: global("Array"))
                return callMethod("call", on: function, withArgs: isFrom ? [constructor, list] : [constructor, loadInt(7), loadInt(8)])
            }
        case 14:
            let value = loadStoredValue(held)
            let uses: [(String, [Variable])] = [
                ("push", [value, value]), ("push", [value]), ("pop", []), ("shift", []), ("unshift", [value]), ("reverse", []), ("fill", [value]),
                ("copyWithin", [loadInt(0), loadInt(1)]), ("sort", []), ("splice", [loadInt(0), loadInt(1), value]),
            ]
            let (method, arguments) = chooseUniform(from: uses)
            printUse(scene, method) { callMethodOfPrototype("Array", method, this: held, arguments) }
        case 15:
            giveExec(scene)
            if probability(0.6) { setProperty("flags", of: held, to: loadString(chooseUniform(from: ["g", "", "gy", "y"]))) }
            let method = chooseUniform(from: ["replace", "match", "search", "split", "test"])
            printUse(scene, method) {
                if method == "test" { return callMethodOfPrototype("RegExp", "test", this: held, [loadString("abc")]) }
                let function = getComputedProperty(createSymbolProperty(method), of: getProperty("prototype", of: global("RegExp")))
                return callMethod("call", on: function, withArgs: [held, loadString("abc"), loadString("x")])
            }
        case 16:
            let descriptors = literal(name, literal("value", loadStoredValue(held)))
            printUse(scene, "defineProperties") { typeof(callMethod("defineProperties", on: global("Object"), withArgs: [held, descriptors])) }
        case 17:
            let base = buildHook(scene, "base", .constructed, parameters: 0) { _ in held }
            let (first, second) = (loadStoredValue(held), loadInt(3))
            let hasSecond = probability(0.5)
            let derived = buildClassDefinition(withSuperclass: base) { definition in
                definition.addInstanceProperty(name, value: first)
                if hasSecond && name != "added" { definition.addInstanceProperty("added", value: second) }
            }
            printUse(scene, "fields") { compare(construct(derived), with: held, using: .strictEqual) }
        case 18:
            let function = buildPlainFunction(with: .parameters(n: 1)) { arguments in
                printCall("function", scene.counter)
                store(scene, into: loadThis())
                doReturn(arguments[0])
            }
            let way = Int.random(in: 0..<4)
            printUse(scene, "this") {
                switch way {
                case 0: return callMethod("apply", on: global("Reflect"), withArgs: [function, held, list])
                case 1: return callMethod("call", on: function, withArgs: [held, loadInt(1)])
                case 2: return callMethod("apply", on: function, withArgs: [held, list])
                default: return callFunction(callMethod("bind", on: function, withArgs: [held]), withArgs: [loadInt(1)])
                }
            }
        case 19:
            let newTarget = buildPlainFunction(with: .parameters(n: 0)) { _ in }
            setProperty("prototype", of: newTarget, to: held)
            let callback = buildHook(scene, "callback") { $0[0] }
            let base = global(chooseUniform(from: ["Object", "Array", "Map", "Error", "Date", "Set"]))
            let way = Int.random(in: 0..<3)
            printUse(scene, "heir") {
                let heir: Variable
                switch way {
                case 0: heir = callMethod("construct", on: global("Reflect"), withArgs: [base, createArray(with: []), newTarget])
                case 1: heir = callMethod("create", on: global("Object"), withArgs: [held])
                default: heir = construct(newTarget)
                }
                callMethod("forEach", on: list, withArgs: [callback])
                return getProperty(name, of: heir)
            }
        case 20:
            let has = buildHook(scene, "has", .calledWithThis, parameters: 1) { _ in loadBool(Bool.random()) }
            let keys = buildHook(scene, "keys", .calledWithThis, parameters: 0) { _ in callMethod("values", on: list) }
            var other = held
            if probability(0.5) {
                setProperty("size", of: held, to: loadInt(2))
                setProperty("has", of: held, to: has)
                setProperty("keys", of: held, to: keys)
            } else {
                let size = loadInt(2)
                other = buildObjectLiteral { object in
                    object.addProperty("size", as: size)
                    object.addProperty("has", as: has)
                    object.addProperty("keys", as: keys)
                }
            }
            let method = chooseUniform(from: ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"])
            printUse(scene, method) { callMethod(method, on: construct(global("Set"), withArgs: [list]), withArgs: [other]) }
        case 21:
            let callback = buildHook(scene, "callback") { $0[0] }
            let method = chooseUniform(from: ["map", "filter", "forEach", "some", "every", "find", "reduce"])
            printUse(scene, method) {
                let result = callMethod(method, on: callMethod("values", on: list), withArgs: [callback])
                return ["map", "filter"].contains(method) ? callMethod("toArray", on: result) : result
            }
        case 22:
            let (holder, method, called) = chooseUniform(from: [
                ("Date", "toJSON", "toISOString"), ("Array", "toString", "join"), ("Object", "toLocaleString", "toString"),
            ])
            let function = buildHook(scene, called, .calledWithThis, parameters: 0) { _ in loadString("text") }
            let receiver = buildHolder(scene, of: function, as: called, isSymbol: false)
            printUse(scene, method) { callMethodOfPrototype(holder, method, this: receiver) }
        case 23:
            let key = chooseUniform(from: ["value", "enumerable", "writable", "get", "cause", "length"])
            let answer = key == "length" ? loadInt(2) : key == "get" ? loadUndefined() : loadStoredValue(held)
            let bag = buildObjectLiteral { bag in
                bag.addGetter(for: key) { _ in
                    printCall("get " + key, scene.counter)
                    store(scene, into: held)
                    doReturn(answer)
                }
            }
            printUse(scene, key) {
                switch key {
                case "cause": return typeof(construct(global("Error"), withArgs: [loadString("message"), bag]))
                case "length": return callMethod("from", on: global("Array"), withArgs: [bag])
                default: return typeof(callMethod("defineProperty", on: global("Object"), withArgs: [held, loadString(name), bag]))
                }
            }
        default:
            let base = chooseUniform(from: ["Array", "Array", "RegExp", "Promise", "Uint8Array"])
            let passesBoth = base == "RegExp"
            let subclass = buildClassDefinition(withSuperclass: global(base)) { definition in
                definition.addConstructor(with: .parameters(n: 2)) { arguments in
                    callSuperConstructor(withArgs: passesBoth ? [arguments[1], arguments[2]] : [arguments[1]])
                    printCall("constructor", scene.counter)
                    store(scene, into: probability(0.2) ? arguments[0] : held)
                }
            }
            let callback = buildHook(scene, "callback") { $0[0] }
            let executor = buildArrowFunction(with: .parameters(n: 1)) { callFunction($0[0], withArgs: [loadInt(1)]) }
            printUse(scene, "subclass of " + base) {
                switch base {
                case "RegExp": return callMethod("split", on: loadString("a,b"), withArgs: [construct(subclass, withArgs: [loadString(","), loadString("")])])
                case "Promise": return typeof(callMethod("then", on: construct(subclass, withArgs: [executor]), withArgs: [callback]))
                default:
                    let instance = construct(subclass, withArgs: [loadInt(3)])
                    let method = chooseUniform(from: ["map", "filter", "slice"])
                    return getProperty("length", of: callMethod(method, on: instance, withArgs: method == "slice" ? [] : [callback]))
                }
            }
        }
    }

    fileprivate func buildSceneOfStores(holding given: Variable?, isInFunction: Bool) {
        let names = Array(storedNames.shuffled().prefix(Int.random(in: 2...3)))
        let readers = names.map { name in buildPlainFunction(with: .parameters(n: 1)) { doReturn(getProperty(name, of: $0[0])) } }
        let scene = SceneOfStores(
            held: given ?? buildHeldObject(), counter: loadInt(0), names: names, readers: readers,
            usesStandInTryBlocks: probability(isInFunction ? 0.3 : 0.7))
        if probability(0.3) { printMembers(scene) }
        for _ in 0..<Int.random(in: 1...2) { buildUseThatStores(scene) }
    }

    /// Calls the function once or in a loop. The try block stands around the call, so the function has none.
    fileprivate func callInTryBlock(_ function: Variable) {
        let turns = chooseUniform(from: [0, 0, 1, 2, 3])
        buildTryCatchFinally(
            tryBody: {
                if turns == 0 {
                    callFunction(function)
                } else {
                    buildRepeatLoop(n: turns) { callFunction(function) }
                }
            },
            catchBody: { error in
                let name = self.getProperty("name", of: error, isReceiverOptional: true)
                self.callFunction(self.global("printValue"), withArgs: [self.loadString("threw"), name])
            })
    }

    /// A program prints every variable of its top level at its end. The held object is not one of them: only the scene has it.
    fileprivate func buildSceneOfStoresInABlockOrAFunction() {
        switch Int.random(in: 0..<10) {
        case 0...2:
            buildBlockStatement { buildSceneOfStores(holding: nil, isInFunction: false) }
        case 3...6:
            callInTryBlock(buildPlainFunction(with: .parameters(n: 0)) { _ in buildSceneOfStores(holding: nil, isInFunction: true) })
        default:
            callFunction(
                buildPlainFunction(with: .parameters(n: 0)) { _ in
                    let given = buildHeldObject()
                    callInTryBlock(buildPlainFunction(with: .parameters(n: 0)) { _ in buildSceneOfStores(holding: given, isInFunction: true) })
                })
        }
    }
}

/// BUN_FUZZILLI_STORES=<percent>: that share of the programs gets one to three scenes of stores at its end. Three in four of those programs are their scenes and nothing else.
struct ScenesOfStores: FuzzingPostProcessor {
    static let share = Double(ProcessInfo.processInfo.environment["BUN_FUZZILLI_STORES"] ?? "").map { $0 / 100 }

    func process(_ program: Program, for fuzzer: Fuzzer) throws -> Program {
        guard probability(Self.share ?? 0) else { return program }
        let b = fuzzer.makeBuilder(forMutating: program)
        if probability(0.25) {
            b.adopting {
                for instr in program.code { b.adopt(instr) }
            }
        }
        for _ in 0..<Int.random(in: 1...3) { b.buildSceneOfStoresInABlockOrAFunction() }
        let result = b.finalize()
        result.contributors = program.contributors
        return result
    }
}

extension ProgramBuilder {
    /// A read or a store under a key that a variable holds, where the key is a name that the receiver really has. What is read goes into a list.
    /// The lifter writes a string into the place that uses it, so the key is a variable with a name. A `var` can be declared twice, which a spliced copy does.
    func buildAccessUnderAKeyInAVariable() {
        let receiver: Variable
        let names: [String]
        switch Int.random(in: 0..<10) {
        case 0:
            receiver = createIntArray(with: (0..<Int.random(in: 0...3)).map { Int64($0) + 5 })
            names = ["length", "length", "length", "0", "-1", "at", "constructor"]
        case 1:
            receiver = createFloatArray(with: [1.5, 2.5])
            names = ["length", "length", "0", "1", "at"]
        case 2:
            receiver = createArray(with: randomJsVariables(n: Int.random(in: 1...2)))
            names = ["length", "length", "0", "at"]
        case 3:
            receiver = loadString("text")
            names = ["length", "0", "at", "constructor"]
        case 4:
            receiver = construct(createNamedVariable(forBuiltin: chooseUniform(from: ["Map", "Set"])))
            names = ["size", "size", "has", "constructor"]
        case 5:
            receiver = construct(
                createNamedVariable(forBuiltin: chooseUniform(from: ["Uint8Array", "Float64Array", "Int32Array"])),
                withArgs: [loadInt(2)])
            names = ["length", "byteLength", "0", "-1", "at"]
        case 6:
            receiver = buildPlainFunction(with: .parameters(n: 2)) { _ in }
            names = ["name", "length", "prototype", "constructor"]
        default:
            receiver = randomJsVariable()
            names = ["length", "size", "name", "constructor", "0"]
        }
        let key = createNamedVariable(
            "key\(Int.random(in: 0..<1000))", declarationMode: .var,
            initialValue: loadString(chooseUniform(from: names)))
        switch Int.random(in: 0..<10) {
        case 0...4:
            _ = createArray(with: [getComputedProperty(key, of: receiver)])
        case 5:
            _ = createArray(with: [getComputedProperty(key, of: receiver), getComputedProperty(key, of: receiver)])
        case 6:
            _ = getComputedProperty(key, of: receiver)
        case 7, 8:
            setComputedProperty(key, of: receiver, to: loadInt(Int64.random(in: -1...3)), guard: true)
            _ = createArray(with: [getComputedProperty(key, of: receiver)])
        default:
            updateComputedProperty(key, of: receiver, with: loadInt(1), using: .Add, guard: true)
            _ = createArray(with: [getComputedProperty(key, of: receiver)])
        }
    }
}

let bunCallbackGenerators: [(CodeGenerator, Int)] = weight == 0 ? [] : [
    (CodeGenerator("BunCountedCallbacksGenerator") { b in
        let counter = b.loadInt(0)
        let objects = (0..<Int.random(in: 1...2)).map { _ in b.buildObjectWithHooks(counter) }
        for _ in 0..<Int.random(in: 1...4) {
            switch Int.random(in: 0..<10) {
            case 0...5: b.buildCallThatCallsBack(counter, objects)
            case 6, 7: b.buildOperatorThatCallsBack(counter, objects)
            default: b.buildIterationThatCallsBack(counter, objects)
            }
        }
    }, 12 * weight),
    (CodeGenerator("BunStoresBehindBuiltinsGenerator") { b in b.buildSceneOfStoresInABlockOrAFunction() }, 12 * weight),
    (CodeGenerator("BunKeysInVariablesGenerator") { b in b.buildAccessUnderAKeyInAVariable() }, 60),
]
