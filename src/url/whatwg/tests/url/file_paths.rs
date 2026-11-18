use bun_url_whatwg::{PathStyle, Url};

use crate::{ascii, string, url};

fn check_both_ways(style: PathStyle, cases: &[(&str, &str)]) {
    for &(path, href) in cases {
        let from_path = Url::from_file_path(string(path).text(), style).unwrap();
        assert_eq!(ascii(from_path.href()), href);
        assert_eq!(from_path.path(), url(href).path());
        assert_eq!(from_path.file_path(style).unwrap(), Some(string(path)));
    }
}

#[test]
fn posix() {
    let cases = [
        ("/", "file:///"),
        ("/a/b.js", "file:///a/b.js"),
        ("//a//", "file:////a//"),
        ("/%2e/?#", "file:///%252e/%3F%23"),
        ("/\t\n\r\0 \u{1}", "file:///%09%0A%0D%00%20%01"),
        ("/[\\]^|~'", "file:///%5B%5C%5D%5E%7C%7E'"),
        ("/é😀", "file:///%C3%A9%F0%9F%98%80"),
        ("/c|/.a/..b", "file:///c%7C/.a/..b"),
    ];
    check_both_ways(PathStyle::Posix, &cases);

    let href = |path| Url::from_file_path(string(path).text(), PathStyle::Posix).unwrap();
    assert_eq!(href("").href(), b"file:///");
    assert_eq!(href("./a/../b/.").href(), b"file:///b/");
    assert_eq!(href("/c:/../a").href(), b"file:///c:/a");
    let path = |href| url(href).file_path(PathStyle::Posix).unwrap();
    assert_eq!(path("file://h/a%2Fb?q"), Some(string("/a/b")));
    assert_eq!(path("file:///%FF"), None);
    assert_eq!(path("http://h/a"), None);
}

#[test]
fn windows() {
    let cases = [
        ("C:\\a\\b.js", "file:///C:/a/b.js"),
        ("C:\\dev\\😂", "file:///C:/dev/%F0%9F%98%82"),
        ("\\a", "file:////a"),
        ("\\\\server\\share", "file://server/share"),
        ("\\\\server\\share\\a b", "file://server/share/a%20b"),
    ];
    check_both_ways(PathStyle::Windows, &cases);

    let href = |path| Url::from_file_path(string(path).text(), PathStyle::Windows).unwrap();
    assert_eq!(href("C:/a\\..\\..\\b").href(), b"file:///C:/b");
    assert_eq!(href("//É/a").href(), b"file://xn--9ca/a");
    let invalid = href("\\\\?\\C:\\a");
    assert!(!invalid.is_valid());
    assert_eq!(invalid.into_string(), Some(string("file://%3F\\C:\\a")));
    let path = |href| url(href).file_path(PathStyle::Windows).unwrap();
    assert_eq!(path("file:///C:/%FF%2F"), Some(string("C:\\\u{fffd}/")));
}
