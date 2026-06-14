type DependencyID = u32;

#[derive(Clone, Copy)]
struct Dependency {
    name_hash: u64,
}

fn hoist_loop_shape(deps: &[Dependency], dependency_ids: &[DependencyID]) -> u64 {
    let mut acc = 0_u64;
    for i in 0..dependency_ids.len() {
        // Mirrors Tree.rs:1014-1020:
        //   dep_id comes from the lockfile's dependency-id list.
        //   deps is the deserialized dependency table.
        let dep_id = unsafe { *dependency_ids.as_ptr().add(i) };
        let dep = unsafe { deps.get_unchecked(dep_id as usize) };
        acc ^= dep.name_hash;
    }
    acc
}

fn main() {
    let deps = [Dependency { name_hash: 0xfeed_beef }];
    let attacker_dependency_ids = [42_u32];
    let _ = hoist_loop_shape(&deps, &attacker_dependency_ids);
}
