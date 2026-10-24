use super::*;

case_tests! {
    inherited_member: PROGRAM, "Array.hasOwnProperty;", |case|
        assert_builtin(case, "Array.hasOwnProperty", BuiltinId::ObjectPrototypeHasOwnProperty);
    type_wrappers: PROGRAM, "(Math as any).floor; Math!.ceil; (Math satisfies object).abs;", |case| {
        assert_builtin(case, "(Math as any).floor", BuiltinId::MathFloor);
        assert_builtin(case, "Math!.ceil", BuiltinId::MathCeil);
        assert_builtin(case, "(Math satisfies object).abs", BuiltinId::MathAbs);
        assert_unresolved(case, "Math as any");
    };
    optional_chain: PROGRAM, "Math?.floor;", |case|
        assert_builtin(case, "Math?.floor", BuiltinId::MathFloor);
    store_target: PROGRAM, "Math.floor = f;", |case|
        assert_builtin(case, "Math.floor", BuiltinId::MathFloor);
    string_literal_is_not_mention: PROGRAM, "const s = \"Bun.serve\";", |case| {
        assert!(!case.mentions(BuiltinId::BunServe));
        assert!(!case.mentions(BuiltinId::Bun));
    };
    type_position_is_not_mention: PROGRAM, "let f: typeof Bun.serve;", |case| {
        assert!(!case.mentions(BuiltinId::BunServe));
        assert!(!case.mentions(BuiltinId::Bun));
    };
    private_name_is_no_member: PROGRAM, "class C { #floor = 1; static f() { return Math.#floor; } }", |case|
        assert_unresolved(case, "Math.#floor");
}

#[test]
fn inherited_member_of_listed_holder() {
    let members = [
        ("Math.toString", BuiltinId::Math, "toString"),
        ("console.toString", BuiltinId::Console, "toString"),
        (
            "Error.prototype.valueOf",
            BuiltinId::ErrorPrototype,
            "valueOf",
        ),
    ];
    let source = "Math.toString; console.toString; Error.prototype.valueOf;";
    with_case(PROGRAM, source, |case| {
        assert_builtin(case, "Math.toString", BuiltinId::ObjectPrototypeToString);
        for (text, holder, name) in members {
            let path = case.path(text);
            let found = path.map(|path| path.id);
            assert_eq!(found, find_member(holder, name), "{text}");
            let is_predicted =
                path.is_none_or(|path| path.mutability <= Mutability::ConstantUnlessWritten);
            assert!(is_predicted, "{text}");
        }
    });
}

#[test]
fn open_holder_inherits_nothing() {
    assert_eq!(find_member(BuiltinId::Bun, "toString"), None);
    with_case(PROGRAM, "Bun.toString;", |case| {
        assert_unresolved(case, "Bun.toString");
        assert!(case.mentions(BuiltinId::Bun));
    });
}

#[test]
fn function_members() {
    let source = "parseFloat.call; parseFloat.name; Object.prototype.hasOwnProperty.call;";
    with_case(PROGRAM, source, |case| {
        assert_builtin(case, "parseFloat.call", BuiltinId::FunctionPrototypeCall);
        let own_name = table::own_member(BuiltinId::ParseFloat, find_name("name"));
        assert!(own_name.is_some());
        assert_eq!(case.builtin("parseFloat.name"), own_name);
        let method = BuiltinId::ObjectPrototypeHasOwnProperty;
        let text = "Object.prototype.hasOwnProperty.call";
        assert_eq!(case.builtin(text), find_member(method, "call"));
    });
}

#[test]
fn global_and_members() {
    let source = "Array.prototype.push; Math.PI; globalThis.Array.isArray;";
    with_case(PROGRAM, source, |case| {
        let expected = [
            ("Array.prototype.push", BuiltinId::ArrayPrototypePush),
            ("Array.prototype", BuiltinId::ArrayPrototype),
            ("Math.PI", BuiltinId::MathPI),
            ("globalThis", BuiltinId::GlobalThis),
            ("globalThis.Array.isArray", BuiltinId::ArrayIsArray),
        ];
        for (text, id) in expected {
            assert_builtin(case, text, id);
            let found = case.resolved.builtin_of_expression(case.expr(text));
            assert_eq!(found, Some(id));
            assert!(case.mentions(id), "{text}");
        }
    });
    with_case(PROGRAM, "Math.notThere; notAGlobal;", |case| {
        assert_unresolved(case, "Math.notThere");
        assert_unresolved(case, "notAGlobal");
        let not_a_global = case.expr("notAGlobal");
        assert_eq!(case.resolved.builtin_of_expression(not_a_global), None);
    });
}

#[test]
fn bracket_string_is_member() {
    with_case(PROGRAM, "Math[\"floor\"]; Math[`ceil`];", |case| {
        assert_builtin(case, "Math[\"floor\"]", BuiltinId::MathFloor);
        assert_builtin(case, "Math[`ceil`]", BuiltinId::MathCeil);
    });
    with_case(PROGRAM, "const k = \"floor\"; Math[k];", |case| {
        assert_unresolved(case, "Math[k]");
    });
}

#[test]
fn same_object_has_one_id() {
    let source = "String.prototype.trimLeft; String.prototype.trimStart; Number.parseFloat; \
                  Number.parseFloat.call; f(Number.parseFloat);";
    with_case(PROGRAM, source, |case| {
        let trim_start = BuiltinId::StringPrototypeTrimStart;
        assert_builtin(case, "String.prototype.trimLeft", trim_start);
        assert_builtin(case, "String.prototype.trimStart", trim_start);
        let parse_float = table::global(find_name("parseFloat"));
        assert!(parse_float.is_some());
        assert_eq!(case.builtin("Number.parseFloat"), parse_float);
        assert_builtin(
            case,
            "Number.parseFloat.call",
            BuiltinId::FunctionPrototypeCall,
        );
        assert!(case.mentions(trim_start));
        assert!(!case.mentions(BuiltinId::StringPrototypeTrimLeft));
        assert!(!case.exposes(BuiltinId::Number));
    });
}

#[test]
fn well_known_symbol_key() {
    let symbol = table::well_known_symbol(BuiltinId::SymbolIterator).unwrap();
    let iterator = table::member(BuiltinId::ArrayPrototype, table::name_of_symbol(symbol));
    let MemberLookup::Found(iterator) = iterator else {
        panic!("Array.prototype[Symbol.iterator] is {iterator:?}");
    };
    let found = table::canonical_id(iterator);
    assert_eq!(found, BuiltinId::ArrayPrototypeValues);
    with_case(PROGRAM, "Array.prototype[Symbol.iterator];", |case| {
        let values = BuiltinId::ArrayPrototypeValues;
        assert_builtin(case, "Array.prototype[Symbol.iterator]", values);
    });
    for key in [
        "\"@@iterator\"",
        "\"iterator\"",
        "Symbol.for(\"x\")",
        "Math.PI",
    ] {
        let text = format!("Array.prototype[{key}]");
        with_case(PROGRAM, &format!("{text};"), |case| {
            assert_unresolved(case, &text);
        });
    }
}

#[test]
fn comma_value() {
    with_case(PROGRAM, "(0, Math.floor);", |case| {
        assert_builtin(case, "0, Math.floor", BuiltinId::MathFloor);
    });
    with_case(PROGRAM, "(Math.floor, 0);", |case| {
        assert_unresolved(case, "Math.floor, 0");
        assert!(case.mentions(BuiltinId::MathFloor));
    });
}

#[test]
fn global_object_aliases() {
    let source = "global.process.pid; self.Array.isArray; globalThis.globalThis.Math;";
    with_case(PROGRAM, source, |case| {
        assert_builtin(case, "global", BuiltinId::GlobalThis);
        assert_builtin(case, "self", BuiltinId::GlobalThis);
        assert_builtin(case, "global.process.pid", BuiltinId::ProcessPid);
        assert_builtin(case, "self.Array.isArray", BuiltinId::ArrayIsArray);
        assert_builtin(case, "globalThis.globalThis.Math", BuiltinId::Math);
    });
    with_case(PROGRAM, "global.notAGlobal;", |case| {
        assert_unresolved(case, "global.notAGlobal");
    });
}

#[test]
fn other_platform() {
    assert!(!table::exists_on(
        BuiltinId::ProcessGetuid,
        Platforms::WINDOWS
    ));
    with_case(PROGRAM, "process.getuid;", |case| {
        assert_builtin(case, "process.getuid", BuiltinId::ProcessGetuid);
    });
    let windows = Setup {
        platform: Platforms::WINDOWS,
        ..PROGRAM
    };
    with_case(windows, "process.getuid; process.pid;", |case| {
        assert_unresolved(case, "process.getuid");
        assert!(!case.mentions(BuiltinId::ProcessGetuid));
        assert_builtin(case, "process.pid", BuiltinId::ProcessPid);
    });
}

mod mutability {
    use super::*;

    fn entry_mutability(id: BuiltinId) -> Mutability {
        table::entry(id).mutability
    }

    #[test]
    fn global_is_predicted() {
        let source = "console; console.log; Date.now; fetch; globalThis;";
        with_case(PROGRAM, source, |case| {
            for text in ["console", "console.log", "Date.now", "fetch", "globalThis"] {
                assert_mutability(case, text, Mutability::ConstantUnlessWritten);
            }
        });
    }

    #[test]
    fn locked_member_of_global_is_predicted() {
        let locked = [
            ("Promise.prototype.then", BuiltinId::PromisePrototypeThen),
            ("Promise.resolve", BuiltinId::PromiseResolve),
            ("Date.UTC", BuiltinId::DateUTC),
        ];
        let source = "Promise.prototype.then; Promise.resolve; Date.UTC;";
        with_case(PROGRAM, source, |case| {
            for (text, id) in locked {
                assert_eq!(entry_mutability(id), Mutability::AlwaysLocked, "{text}");
                assert_builtin(case, text, id);
                assert_mutability(case, text, Mutability::ConstantUnlessWritten);
            }
        });
    }

    #[test]
    fn member_of_locked_global_is_locked() {
        let locked = [
            "Symbol",
            "Symbol.iterator",
            "Math.imul",
            "Object.keys",
            "Object.getOwnPropertyNames",
            "Array.isArray",
            "Array.prototype.push",
            "Number.isInteger",
            "Reflect.get",
            "JSON",
        ];
        with_case(PROGRAM, &format!("{};", locked.join("; ")), |case| {
            for text in locked {
                assert_mutability(case, text, Mutability::AlwaysLocked);
            }
        });
    }

    #[test]
    fn member_that_packages_replace_is_predicted() {
        let open = ["Math.random", "JSON.parse", "Number.parseInt"];
        with_case(PROGRAM, &format!("{};", open.join("; ")), |case| {
            for text in open {
                assert_mutability(case, text, Mutability::ConstantUnlessWritten);
            }
        });
    }

    #[test]
    fn only_object_or_symbol_stands_for_locked_path() {
        let source = "Math.imul; Math.PI; Symbol.iterator; Math.random;";
        with_case(PROGRAM, source, |case| {
            assert_mutability(case, "Math.PI", Mutability::AlwaysLocked);
            let locked_builtin = |text| case.path(text).and_then(|path| path.locked_builtin());
            assert_eq!(locked_builtin("Math.imul"), Some(BuiltinId::MathImul));
            let found = locked_builtin("Symbol.iterator");
            assert_eq!(found, Some(BuiltinId::SymbolIterator));
            assert_eq!(locked_builtin("Math.PI"), None);
            assert_eq!(locked_builtin("Math.random"), None);
        });
    }

    #[test]
    fn inherited_member_of_locked_holder_is_predicted() {
        let has_own_property = BuiltinId::ObjectPrototypeHasOwnProperty;
        assert_eq!(entry_mutability(has_own_property), Mutability::AlwaysLocked);
        with_case(PROGRAM, "Symbol.hasOwnProperty;", |case| {
            assert_builtin(case, "Symbol.hasOwnProperty", has_own_property);
            let predicted = Mutability::ConstantUnlessWritten;
            assert_mutability(case, "Symbol.hasOwnProperty", predicted);
        });
    }

    #[test]
    fn member_of_locked_prototype_is_locked_below_original() {
        let locked = ["Promise.prototype.then", "Promise.resolve"];
        let source = "Promise.prototype.then; Promise.resolve; Promise.try;";
        with_case(RUNTIME, source, |case| {
            for text in locked {
                assert_mutability(case, text, Mutability::AlwaysLocked);
            }
            let predicted = Mutability::ConstantUnlessWritten;
            assert_mutability(case, "Promise.try", predicted);
        });
        with_case(PROGRAM, source, |case| {
            assert_builtin(case, locked[0], BuiltinId::PromisePrototypeThen);
            assert_builtin(case, locked[1], BuiltinId::PromiseResolve);
            for text in locked {
                assert_mutability(case, text, Mutability::ConstantUnlessWritten);
            }
        });
    }

    #[test]
    fn self_changing_location() {
        with_case(PROGRAM, "process.exitCode;", |case| {
            assert_builtin(case, "process.exitCode", BuiltinId::ProcessExitCode);
            assert_mutability(case, "process.exitCode", Mutability::ChangesOnItsOwn);
        });
    }

    #[test]
    fn computed_key_weakens() {
        let text = "Promise[Symbol.species]";
        with_case(PROGRAM, "Promise[Symbol.species];", |case| {
            assert_mutability(case, text, Mutability::ConstantUnlessWritten);
        });
        with_case(RUNTIME, "$Array.prototype[Symbol.iterator];", |case| {
            let text = "$Array.prototype[Symbol.iterator]";
            assert_builtin(case, text, BuiltinId::ArrayPrototypeValues);
            assert_mutability(case, text, Mutability::AlwaysLocked);
        });
        let source = "const key = Symbol.iterator; $Array.prototype[key];";
        with_case(RUNTIME, source, |case| {
            assert_builtin(
                case,
                "$Array.prototype[key]",
                BuiltinId::ArrayPrototypeValues,
            );
            let predicted = Mutability::ConstantUnlessWritten;
            assert_mutability(case, "$Array.prototype[key]", predicted);
        });
    }

    #[test]
    fn comma_value_is_predicted() {
        with_case(PROGRAM, "(0, Symbol.iterator);", |case| {
            assert_mutability(case, "Symbol.iterator", Mutability::AlwaysLocked);
            let predicted = Mutability::ConstantUnlessWritten;
            assert_mutability(case, "0, Symbol.iterator", predicted);
        });
    }
}
