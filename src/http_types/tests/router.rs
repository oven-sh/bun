use bun_core::strings::ByteSet;
use bun_http_types::Method::Method;
use bun_http_types::router::{Parameters, Router};

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stands in for highway_byte_set.cpp.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_byte_set_prefix_length(
    text: *const u8,
    len: usize,
    set: &ByteSet,
) -> usize {
    // SAFETY: `ByteSet::prefix_len` passes a slice.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter().take_while(|&&byte| set.contains(byte)).count()
}

/// `"GET /a"`, or `"/a"` for any method. Each one is its own handler.
fn router<'a>(routes: &[&'a str]) -> Router<&'a str> {
    let mut router = Router::default();
    for route in routes {
        match route.as_bytes() {
            [b'G', b'E', b'T', b' ', pattern @ ..] => {
                router.add(Some(Method::GET), pattern, *route)
            }
            [b'P', b'U', b'T', b' ', pattern @ ..] => {
                router.add(Some(Method::PUT), pattern, *route)
            }
            pattern => router.add(None, pattern, *route),
        }
    }
    router
}

/// All that match, the best first, each with its parameters.
fn matches(router: &Router<&str>, method: Method, path: &str) -> Vec<String> {
    let mut parameters = Parameters::new();
    let find = |skip| {
        let mut found = (router.find(method, path.as_bytes(), skip, &mut parameters)?).to_owned();
        for parameter in parameters.iter() {
            found = format!("{found} {}", bstr::BStr::new(parameter));
        }
        Some(found)
    };
    (0..).map_while(find).collect()
}

fn get(router: &Router<&str>, path: &str) -> Vec<String> {
    matches(router, Method::GET, path)
}

#[test]
fn names_go_before_parameters_and_those_before_wildcards() {
    let router = router(&["/*", "/a/*", "/:x/*", "/:x/b", "/:x/:y", "/a/:y", "/a/b"]);
    assert_eq!(
        get(&router, "/a/b"),
        [
            "/a/b",
            "/a/:y b",
            "/a/*",
            "/:x/b a",
            "/:x/:y a b",
            "/:x/* a",
            "/*"
        ]
    );
    assert_eq!(get(&router, "/c/d/e"), ["/:x/* c", "/*"]);
}

#[test]
fn the_method_only_decides_between_routes_of_one_shape() {
    let router = router(&["/a/b", "GET /a/:y", "/*", "GET /*", "PUT /a/b", "PUT /c"]);
    assert_eq!(
        get(&router, "/a/b"),
        ["/a/b", "GET /a/:y b", "GET /*", "/*"]
    );
    assert_eq!(get(&router, "/c"), ["GET /*", "/*"]);
    assert_eq!(
        matches(&router, Method::PUT, "/a/b"),
        ["PUT /a/b", "/a/b", "/*"]
    );
    for method in [Method::ACL, Method::UNSUBSCRIBE] {
        assert_eq!(matches(&router, method, "/a/b"), ["/a/b", "/*"]);
        assert_eq!(matches(&router, method, "/c"), ["/*"]);
    }
}

#[test]
fn a_route_replaces_the_one_of_its_shape_and_method() {
    let router = router(&[
        "/:a", "GET /:a", "PUT /:a", "GET /:b", "/:", "/*", "GET /*", "/*",
    ]);
    assert_eq!(get(&router, "/x"), ["GET /:b x", "/: x", "GET /*", "/*"]);
    assert_eq!(
        matches(&router, Method::PUT, "/x"),
        ["PUT /:a x", "/: x", "/*"]
    );
    assert_eq!(matches(&router, Method::ACL, "/x"), ["/: x", "/*"]);
}

#[test]
fn a_wildcard_that_replaces_another_goes_last() {
    let get = |routes: &[&str]| get(&router(routes), "/x");
    assert_eq!(get(&["/*", "/*y", "/*"]), ["/*y", "/*"]);
    assert_eq!(get(&["GET /*", "/*y", "GET /*"]), ["/*y", "GET /*"]);
    assert_eq!(
        get(&["GET /*", "/*y", "/*", "GET /*"]),
        ["GET /*", "/*", "/*y"]
    );
}

#[test]
fn wildcards_of_a_name_stay_together() {
    let router = router(&["GET /*", "/*y", "GET /*z", "/*", "/*z"]);
    assert_eq!(
        get(&router, "/x"),
        ["GET /*", "/*", "/*y", "GET /*z", "/*z"]
    );
    assert_eq!(matches(&router, Method::PUT, "/x"), ["/*y", "/*", "/*z"]);
}

#[test]
fn a_route_for_any_method_is_replaced_for_all_of_them() {
    let wildcards = router(&["GET /*", "/*", "/*y", "/*"]);
    assert_eq!(get(&wildcards, "/x"), ["GET /*", "/*", "/*y"]);
    assert_eq!(matches(&wildcards, Method::PUT, "/x"), ["/*y", "/*"]);
    let parameters = router(&["GET /:a", "/:b", "/:c"]);
    assert_eq!(get(&parameters, "/x"), ["GET /:a x", "/:c x"]);
    assert_eq!(matches(&parameters, Method::PUT, "/x"), ["/:c x"]);
}

#[test]
fn names_that_begin_and_end_alike_are_told_apart() {
    let names = [
        "/a",
        "/\0a",
        "/aaaa",
        "/aaaaa",
        "/ababa",
        "/abcdefgh",
        "/abcd1efgh",
        "/abcd2efgh",
        "/abcd12efgh",
    ];
    let router = router(&names);
    for name in names {
        assert_eq!(get(&router, name), [name]);
    }
    for path in [
        "/bbbb",
        "/babab",
        "/aaaaaa",
        "/abcd3efgh",
        "/abcd21efgh",
        "/abcdXfgh",
    ] {
        assert_eq!(get(&router, path), [""; 0]);
    }
}

#[test]
fn segments_can_be_empty_but_parameters_cannot() {
    let router = router(&["", "/", "/a", "/a/", "//", "/:x", "/a/*", "/a/:y"]);
    assert_eq!(get(&router, ""), [""]);
    assert_eq!(get(&router, "/"), ["/"]);
    assert_eq!(get(&router, "//"), ["//"]);
    assert_eq!(get(&router, "/a"), ["/a", "/:x a"]);
    assert_eq!(get(&router, "/a/"), ["/a/", "/a/*"]);
    assert_eq!(get(&router, "/:"), ["/:x :"]);
    assert_eq!(get(&router, "/*"), ["/:x *"]);
    // The first byte is taken for a slash.
    assert_eq!(get(&router, "*"), ["/"]);
    assert_eq!(get(&router, "aa"), ["/a", "/:x a"]);
}

#[test]
fn only_the_first_byte_makes_a_parameter_or_a_wildcard() {
    let router = router(&["/*/c", "/a:b", "/a*", "/*x", "/*", "GET /*y", "/b/*/c"]);
    assert_eq!(get(&router, "/ab"), ["/*x", "/*", "GET /*y"]);
    assert_eq!(get(&router, "/a:b")[0], "/a:b");
    assert_eq!(get(&router, "/a*")[0], "/a*");
    assert_eq!(get(&router, "/b/x/c")[0], "/*x");
}

#[test]
fn every_name_is_found() {
    let names: Vec<String> = (0..60)
        .map(|n| format!("/{:x}/{}", n * 7919 % 4099, "abc".repeat(n % 9)))
        .collect();
    let router = router(&names.iter().map(String::as_str).collect::<Vec<_>>());
    for name in &names {
        assert_eq!(get(&router, name), [&**name]);
        assert_eq!(get(&router, &format!("{name}d")), [""; 0]);
        assert_eq!(get(&router, &format!("/g{}", &name[2..])), [""; 0]);
    }
}

#[test]
fn many_parameters_keep_their_values() {
    let router = router(&[
        "/1/:/:/:/:/:/:/:/:/:",
        "/:/:/:/:/:/:/:/:/:/x",
        "/:/:/:/:/:/:/:/:/*",
        "/:/*",
    ]);
    assert_eq!(
        get(&router, "/1/2/3/4/5/6/7/8/9/0"),
        [
            "/1/:/:/:/:/:/:/:/:/: 2 3 4 5 6 7 8 9 0",
            "/:/:/:/:/:/:/:/:/* 1 2 3 4 5 6 7 8",
            "/:/* 1",
        ]
    );
}

#[test]
fn what_follows_100_segments_is_ignored() {
    let count = |pattern: String, path: String| {
        let mut parameters = Parameters::new();
        let found = router(&[&pattern]).find(Method::GET, path.as_bytes(), 0, &mut parameters);
        found.map(|_| parameters.len())
    };
    assert_eq!(count("/:".repeat(99), "/a".repeat(99)), Some(99));
    assert_eq!(count("/:".repeat(99), "/a".repeat(100)), None);
    assert_eq!(count("/:".repeat(100), "/a".repeat(99)), None);
    assert_eq!(count("/:".repeat(100), "/a".repeat(101)), Some(100));
    assert_eq!(count("/:".repeat(101), "/a".repeat(100)), Some(100));
    assert_eq!(count("/:".repeat(98) + "/*/b", "/a".repeat(99)), None);
    assert_eq!(count("/:".repeat(99) + "/*/b", "/a".repeat(100)), Some(99));
}

#[test]
fn it_starts_empty() {
    assert!(router(&[]).is_empty());
    assert!(!router(&["/"]).is_empty());
    assert_eq!(get(&router(&[]), "/"), [""; 0]);
}
