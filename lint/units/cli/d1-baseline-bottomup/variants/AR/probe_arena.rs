#[test]
fn probe_an_arena_is_made_and_dropped() {
    let arena = bun_alloc::Arena::new();
    drop(arena);
}
