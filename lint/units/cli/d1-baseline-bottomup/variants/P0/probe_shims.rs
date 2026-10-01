use bun_core::strings;

#[test]
fn probe_highway_past_the_scalar_cutoff() {
    let mut text = [b'a'; 64];
    text[40] = b'/';
    text[50] = b'/';
    assert_eq!(strings::index_of_char_usize(&text, b'/'), Some(40));
    assert_eq!(strings::last_index_of_char(&text, b'/'), Some(50));
    assert_eq!(strings::count_char(&text, b'/'), 2);
    assert_eq!(strings::index_of_any(&text, b"/x"), Some(40));
    assert_eq!(strings::index_of(&text, b"a/a"), Some(39));
}

#[test]
fn probe_is_all_ascii_past_the_scalar_cutoff() {
    let text = [b'a'; 64];
    assert!(bun_core::is_all_ascii(&text));
}
