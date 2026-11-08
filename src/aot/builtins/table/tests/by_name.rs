use super::super::*;
use super::all_ids;

#[test]
fn test_runner_and_plugin_are_found_under_their_names() {
    assert_eq!(test_runner(), Some(RuntimeModule::BunTest));
    for module in RuntimeModule::ALL {
        assert_eq!(is_test_runner(module), module == RuntimeModule::BunTest);
    }
    for id in all_ids() {
        let canonical = canonical_id(id);
        assert_eq!(
            returns_test_runner(id),
            canonical == canonical_id(BuiltinId::BunJest),
            "{}",
            text_of(id)
        );
        assert_eq!(
            is_plugin(id),
            canonical == canonical_id(BuiltinId::BunPlugin),
            "{}",
            text_of(id)
        );
        let is_below_runner = entry(root_of(id)).module == Some(RuntimeModule::BunTest);
        assert_eq!(is_of_test_runner(id), is_below_runner, "{}", text_of(id));
    }
    assert!(is_of_expect(BuiltinId::Expect) && is_of_expect(BuiltinId::ExpectAny));
    assert_ne!(
        canonical_id(BuiltinId::BunTestVitestExpect),
        BuiltinId::Expect
    );
    assert!(
        is_of_expect(BuiltinId::BunTestVitestExpect)
            && is_of_expect(BuiltinId::BunTestVitestExpectSoft)
    );
    assert!(!is_of_expect(BuiltinId::BunTestSpyOn) && !is_of_expect(BuiltinId::Bun));
    assert!(is_of_test_runner(BuiltinId::BunTestSpyOn));
    assert!(!is_of_test_runner(BuiltinId::Bun));
}
