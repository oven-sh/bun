mod support;

use bun_engine_syntax::ErrorKind;
use support::{SCRIPT, error_of};

fn nested(open: &str, inner: &str, close: &str, depth: usize) -> String {
    [&open.repeat(depth), inner, &close.repeat(depth)].concat()
}

#[test]
fn deep_nesting_overflows() {
    for (open, inner, close) in [
        ("(", "a", ")"),
        ("{", "", "}"),
        ("a(", "", ")"),
        ("a[", "b", "]"),
        ("`${", "a", "}`"),
        ("a=", "b", ""),
        ("a?", "b", ":c"),
        ("a?b:", "c", ""),
        ("a=>", "b", ""),
        ("new a(", "", ")"),
        ("import(", "a", ")"),
        ("!(", "a", ")"),
        ("if(a)", ";", ""),
        ("function a(){", "", "}"),
        ("function a(b=function(c=", "1", "){}){}"),
        ("(class extends ", "a", "{})"),
        ("(class{a=", "1", "})"),
        ("(class{static{", "", "}})"),
        ("[a]=", "b", ""),
    ] {
        let error = error_of(&nested(open, inner, close, 100_000), SCRIPT);
        let kind = error.map(|error| error.kind);
        assert_eq!(kind, Some(ErrorKind::StackOverflow), "{open}");
    }
    for (head, open, close) in [
        ("async function a(){", "await !", ""),
        ("function* a(){", "yield ", ""),
        ("{var ", "[", "]"),
        ("{var ", "{a:", "}"),
    ] {
        let source = [head, &nested(open, "b", close, 100_000), "=c}"].concat();
        let kind = error_of(&source, SCRIPT).map(|error| error.kind);
        assert_eq!(kind, Some(ErrorKind::StackOverflow), "{open}");
    }
}

#[test]
fn long_chains_take_no_stack() {
    for (head, link, tail) in [
        ("a", "+a", ""),
        ("a", "**a", ""),
        ("a", ".a", ""),
        ("a", "?.a", ""),
        ("a", "()", ""),
        ("a", ",a", ""),
        ("", "!", "a"),
        ("", "new ", "a"),
        ("if(a);", "else if(a);", ""),
        ("", "//\n", ""),
        ("", "/**/ ", ""),
        ("", " \n", ""),
    ] {
        let chain = [head, &link.repeat(50_000), tail].concat();
        assert!(error_of(&chain, SCRIPT).is_none(), "{link}");
        let inner = ["function a(){", &chain, "}"].concat();
        assert!(error_of(&inner, SCRIPT).is_none(), "{link}");
    }
}

#[test]
fn guesses_within_guesses() {
    let gap = " ".repeat(5000);
    for (open, inner, close) in [
        ("[a=", "b", "]=c"),
        ("(a=`${", "b", "}`)=>c"),
        ("({[", "a", "]:b})=>c"),
        ("[[", "a", "].b]=c"),
        ("(a=", "yield", ")=>c"),
        ("(await=", "b", ")=>c"),
        ("async(a=/b/,...[c=", "d", "])=>await e"),
        ("({__proto__:a,__proto__:b=", "c", "}=d)"),
        ("[a=function(){", "", "}]=b"),
        ("for([class{static{", "", "}}];;);"),
        ("for([a=class{static{", "", "}}]of b);"),
    ] {
        let error = error_of(&nested(open, &[&gap, inner].concat(), close, 8), SCRIPT);
        assert!(error.is_none(), "{open}");
    }
    for (open, close) in [
        ("[", "]"),
        ("(a=", ")"),
        ("({a:", "})"),
        ("[function(){", "}]"),
        ("[a=", "]=b"),
        ("(a=", ")=>b"),
    ] {
        let error = error_of(&nested(open, &[&gap, "1 2"].concat(), close, 8), SCRIPT);
        assert_eq!(error.map(|error| error.kind), Some(ErrorKind::Syntax));
    }
}
