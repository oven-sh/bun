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
]
